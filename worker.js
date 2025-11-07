export default {
  async fetch(request, env) {
    const BOT_TOKEN = env.BOT_TOKEN;
    const BOT_USERNAME = env.BOT_USERNAME;
    const REPORT_USER_ID = "1234567889"; // User ID for forwarding deleted messages
    const VIOLATION_MESSAGE = "نباید کپشن بیش از 5 کلمه بنویسی. پیامت حذف شد"; // پیام اخطار ثابت

    if (!BOT_TOKEN || !BOT_USERNAME) {
      console.error("Missing required environment variables: BOT_TOKEN or BOT_USERNAME");
      return new Response("Server misconfigured", { status: 500 });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/webhook" && request.method === "POST") {
        const update = await request.json();
        console.log("Webhook update received:", JSON.stringify(update, null, 2));

        const chat = update.message?.chat;
        const messageId = update.message?.message_id;
        const sender = update.message?.from;

        if (!chat || !messageId) {
          console.error("Invalid update: missing chat or messageId");
          return new Response("Invalid update", { status: 400 });
        }

        // بررسی نوع چت (گروه یا خصوصی)
        const isGroup = chat.type === "group" || chat.type === "supergroup";
        console.log("Chat type:", chat.type, "Is group:", isGroup, "Message ID:", messageId);

        try {
          console.log("Attempting to add 👍 reaction to message:", messageId, "in chat type:", chat.type);
          const reactionRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMessageReaction`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chat.id,
              message_id: messageId,
              reaction: [{ type: "emoji", emoji: "👍" }],
              is_big: false,
            }),
          });
          const reactionData = await reactionRes.json();
          if (!reactionData.ok) {
            console.error("Reaction API error for message", messageId, ":", reactionData.description);
          } else {
            console.log("Reaction 👍 added successfully for message:", messageId);
          }
        } catch (error) {
          console.error("Error setting reaction for message", messageId, ":", error.message);
        }

        if (chat.type === "private") {
          const autoMessage = `سلام! 👋\nبرای تبلیغ لطفا به @Argh94 پیام بدید و برای عضویت در گروه زیر کلیک کنید:`;
          const autoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chat.id,
              text: autoMessage,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "عضویت در گروه",
                      url: "https://t.me/+8UV59QfceLSxsmNjfg0",
                    },
                  ],
                ],
              },
            }),
          });
          const autoData = await autoRes.json();
          if (!autoData.ok) {
            console.error("Failed to send private message:", autoData.description);
          }
          return new Response("Private chat message processed", { status: 200 });
        }

        if (!isGroup) {
          console.log("Non-group chat, skipping group-specific logic");
          return new Response("OK", { status: 200 });
        }

        let admins = [];
        try {
          const adminsRes = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getChatAdministrators?chat_id=${chat.id}`
          );
          const adminsData = await adminsRes.json();
          if (!adminsData.ok) {
            console.error("Failed to fetch admins:", adminsData.description);
          } else {
            admins = adminsData.result || [];
            console.log("Admins fetched:", admins.map(a => a.user.id));
          }
        } catch (error) {
          console.error("Error fetching admins:", error.message);
        }
        const isAdmin = sender ? admins.some((admin) => admin.user.id === sender.id) : false;
        console.log("Sender:", sender?.id, "Is admin:", isAdmin);
        const senderName = sender?.username ? `@${sender.username}` : sender?.first_name || "کاربر";

        const isSystemMessage =
          update.message?.new_chat_members ||
          update.message?.left_chat_member ||
          update.message?.group_chat_created ||
          update.message?.new_chat_title ||
          update.message?.new_chat_photo ||
          update.message?.delete_chat_photo;

        if (isSystemMessage) {
          if (update.message?.new_chat_members) {
            const newMember = update.message.new_chat_members[0];
            const welcomeMessage = `سلام ${newMember.first_name}! 👋\nبه گروه کد خوش اومدید.\nقوانین:\n- فقط عکس/ویدیو کد با کپشن حداکثر 5 کلمه.\n- لینک فقط توسط ادمین‌ها.\n- چت ممنوع.\n- کلمات ناپسند یا کلمات "ادمین"، "مدیر"، "admin" در کپشن ممنوع.`;
            const welcomeRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: newMember.id,
                text: welcomeMessage,
                parse_mode: "HTML",
              }),
            });
            const welcomeData = await welcomeRes.json();
            if (!welcomeData.ok) {
              console.error("Failed to send welcome message:", welcomeData.description);
            }
          }
          await deleteMessage(BOT_TOKEN, chat.id, messageId);
          return new Response("System message deleted", { status: 200 });
        }

        const text = update.message?.text || update.message?.caption || "";
        const entities = update.message?.entities || update.message?.caption_entities || [];
        console.log("Message text/caption:", text);

        if (
          !isAdmin &&
          (update.message.sticker ||
            update.message.animation ||
            update.message.voice ||
            update.message.document ||
            update.message.forward_date ||
            (update.message.text && !update.message.photo && !update.message.video))
        ) {
          await handleViolation(BOT_TOKEN, REPORT_USER_ID, chat.id, messageId, senderName, VIOLATION_MESSAGE);
          return new Response("Irrelevant message deleted", { status: 200 });
        }

        if (!isAdmin && (update.message.photo || update.message.video) && update.message.caption) {
          const cleanCaption = update.message.caption.replace(/[\n\r]+/g, " ").trim();
          const captionWords = cleanCaption.split(/\s+/).filter(word => word.length > 0).length;
          console.log("Caption word count:", captionWords, "Clean caption:", cleanCaption);
          if (captionWords > 5) {
            await handleViolation(BOT_TOKEN, REPORT_USER_ID, chat.id, messageId, senderName, VIOLATION_MESSAGE);
            return new Response("Long caption deleted", { status: 200 });
          }
        }

        const hasTextLink = /(https?:\/\/|t\.me\/|www\.|[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/|$))/i.test(text);
        const hasEntityLink = entities.some(
          (entity) =>
            entity.type === "url" ||
            entity.type === "text_link" ||
            (entity.type === "mention" && /t\.me\//i.test(text.slice(entity.offset, entity.offset + entity.length)))
        );

        if ((hasTextLink || hasEntityLink) && !isAdmin) {
          await handleViolation(BOT_TOKEN, REPORT_USER_ID, chat.id, messageId, senderName, VIOLATION_MESSAGE);
          return new Response("Non-admin link deleted", { status: 200 });
        }

        // --- 7. فیلتر کلمات بد و خاص ---
        const badWords = [
          "فحش",
          "توهین",
          "اسپم",
          "ادمین",
          "مدیر",
          "admin",
          "کثافت",
          "بی‌شرف",
          "بی‌ناموس",
          "هرزه",
          "فاسد",
          "جنده",
          "گوه",
          "کون",
          "کص",
          "مادرجنده",
          "پدرسگ",
          "حرومزاده",
          "دیوث",
          "لاشی",
          "اشغال",
          "گاو",
          "الاغ",
          "خر",
          "سگ",
          "عوضی",
          "بی‌غیرت",
          "پست",
          "رذل",
          "کثیف",
          "چرک"
        ];
        if (badWords.some((word) => text.toLowerCase().includes(word.toLowerCase())) && !isAdmin) {
          await handleViolation(BOT_TOKEN, REPORT_USER_ID, chat.id, messageId, senderName, VIOLATION_MESSAGE);
          return new Response("Bad word or restricted word deleted", { status: 200 });
        }

        if (isAdmin && text.startsWith("/")) {
          const command = text.split(" ")[0].toLowerCase();

          if (command === "/stats") {
            const activeMembersRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMemberCount?chat_id=${chat.id}`);
            const activeMembersData = await activeMembersRes.json();
            if (!activeMembersData.ok) {
              console.error("Failed to fetch member count:", activeMembersData.description);
              return new Response("Failed to process stats", { status: 200 });
            }
            const activeMembers = activeMembersData.result || "نامشخص";
            const statsMessage = `📊 آمار گروه:\nاعضای فعال: ${activeMembers}`;
            const statsRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chat.id,
                text: statsMessage,
              }),
            });
            const statsData = await statsRes.json();
            if (!statsData.ok) {
              console.error("Failed to send stats message:", statsData.description);
            }
            return new Response("Stats command processed", { status: 200 });
          }

          if (command === "/pin_rules") {
            const rulesMessageRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chat.id,
                text: "📜 قوانین گروه کد:\n- فقط عکس/ویدیو کد با کپشن حداکثر 5 کلمه.\n- لینک فقط توسط ادمین.\n- چت ممنوع.\n- کلمات ناپسند یا کلمات 'ادمین'، 'مدیر'، 'admin' در کپشن ممنوع.",
              }),
            });
            const rulesData = await rulesMessageRes.json();
            if (!rulesData.ok) {
              console.error("Failed to send rules message:", rulesData.description);
              return new Response("Failed to pin rules", { status: 200 });
            }
            const pinRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/pinChatMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chat.id,
                message_id: rulesData.result.message_id,
                disable_notification: true,
              }),
            });
            const pinData = await pinRes.json();
            if (!pinData.ok) {
              console.error("Failed to pin rules:", pinData.description);
            }
            return new Response("Rules pinned", { status: 200 });
          }
        }

        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error.message, error.stack);
      return new Response("Internal server error", { status: 500 });
    }
  },
};

async function deleteMessage(token, chatId, messageId) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Delete message error:", data.description);
    } else {
      console.log("Message deleted:", messageId);
    }
  } catch (error) {
    console.error("Error deleting message:", error.message);
  }
}

async function sendLog(token, chatId, message) {
  try {
    const logRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });
    const logData = await logRes.json();
    if (!logData.ok) {
      console.error("Failed to send log message:", logData.description);
      return;
    }
    const logMessageId = logData.result?.message_id;
    if (logMessageId) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      await deleteMessage(token, chatId, logMessageId);
    }
  } catch (error) {
    console.error("Error sending log:", error.message);
  }
}

async function forwardDeletedMessage(token, reportUserId, chatId, messageId) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/forwardMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: reportUserId,
        from_chat_id: chatId,
        message_id: messageId,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Forward message error:", data.description);
    } else {
      console.log("Message forwarded to report user:", messageId);
    }
  } catch (error) {
    console.error("Error forwarding message:", error.message);
  }
}

async function handleViolation(token, reportUserId, chatId, messageId, senderName, violationMessage) {
  console.log("Handling violation for message:", messageId, "from:", senderName);
  await forwardDeletedMessage(token, reportUserId, chatId, messageId);
  await sendLog(token, chatId, `${violationMessage} ${senderName}.`);
  await deleteMessage(token, chatId, messageId);
}
