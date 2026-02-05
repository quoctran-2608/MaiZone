/**
 * MaiZone Browser Extension
 * Constants: Centralized configuration values
 * @feature f13 - Intent Gate for Distracting Sites
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode
 * @feature f06 - ClipMD (Clipboard to Markdown)
 * @feature f08 - Mindfulness Reminders
 */

/******************************************************************************
 * BREAK REMINDER [f03]
 ******************************************************************************/

// Break reminder interval (40 minutes)
export const BREAK_REMINDER_INTERVAL = 40 * 60 * 1000;

// Fun Gen-Z style break reminder messages
export const BREAK_REMINDER_MESSAGES = [
  "🌸 Ê ê, não cậu sắp nổ tung rồi kìa! Nghỉ xíu đi, lướt TikTok tí cho sướng! 🌸💥",
  "🌸 Chốt kèo: 5 phút đi lại + 1 ly nước = đầy bình năng lượng! Deal? 🤙💦",
  "🌸 Ủa khoan, đã 40 phút rồi á? Cậu muốn làm con mọt máy tính hả? Break đi fen ơi! 💀✌️",
  "🌸 Não cậu đang bốc khói kìa! Nghỉ chút đi bro! 🔥👀",
  "🌸 Bật dậy stretch tí đi! Ngồi hoài không những mông to mà còn não teo nữa đó! 🍑🧠",
  "🌸 Trời ơi tin được không? Nghỉ ngơi 5p = tăng 100 điểm IQ đó! Mai không nói điêu đâu! 💯🤓",
  "🌸 POV: Cậu thấy tin nhắn này vì não đang kêu cứu! Đứng dậy đi nào, làm tí thư giãn đi! 🎧👣",
  "🌸 Mai báo tin hot: Quá 40p không nghỉ = auto giảm 10 năm tuổi thọ! Scary AF! 😱⏰",
  "🌸 Ê! Thật không thể tin được! Mai phát hiện cậu đã ngồi lâu quá! Slay não bằng cách nghỉ xíu đi! ✨💅",
  "🌸 Vibe check! Đôi mắt cậu đỏ hoe rồi kìa! Nghỉ ngơi là tự thương bản thân đó, biết chưa? 👁️❤️",
  "🌸 URGENT NEWS: Cậu đang đe dọa sự tồn tại của ghế với cái mông của mình đấy! Đứng dậy đi naoooo! 🪑🔥",
  "🌸 Plot twist kinh điển: Màn hình máy tính không phải người yêu của cậu! Chia tay nó 5 phút đi! 💔📱",
  "🌸 Ayo fr fr! Các ngón tay cậu đang kiệt sức rồi! Cho nó đi nghỉ mát tí đi! 🏰👆",
  "🌸 Breaking news: Nghiên cứu mới cho thấy 10 phút chill mỗi giờ giúp bạn không thành zombie công sở! 🧟‍♂️💼",
  "🌸 Nếu cậu không nghỉ ngơi ngay, Mai sẽ thả thính cậu đấy! Đừng bảo là Mai không cảnh báo! 😘🚨",
  "🌸 Đố cậu biết ai cần nghỉ ngơi? Người đang đọc dòng này đấy! Surprise! 🎉👀",
  "🌸 No cap! Não cậu đang bơi trong caffeine và stress rồi kìa! Cho nó thở tí đi, bruh! 🏊‍♂️☕",
  "🌸 Sheesh! 40 phút code liên tục? Ok, I see you! Nhưng Mai thấy mắt cậu đỏ như ma cà rồng! 👹👀",
  "🌸 Cậu có biết là đang làm mông teo đi không? Stand up for your rights... và cho mông! ✊🍑",
  "🌸 Còn chờ gì nữa? Inbox người yêu 1 tin nhắn ngọt ngào rồi hẵng quay lại làm việc! 💌💕"
];

/******************************************************************************
 * MINDFULNESS REMINDERS [f08]
 ******************************************************************************/

// Mindfulness reminder interval (15 minutes)
export const MINDFULNESS_REMINDER_INTERVAL_MINUTES = 15;

// Short, kind reminders (quotes) to bring attention back gently.
export const MINDFULNESS_QUOTES = [
  '🌸 Hít vào sâu. Thở ra chậm. Mỉm cười nhẹ.',
  '🌸 Chỉ cần một nhịp thở, mình quay về hiện tại.',
  '🌸 Nhẹ nhàng với chính mình.',
  '🌸 Bạn đang làm tốt rồi.',
  '🌸 Một bước nhỏ cũng là tiến lên.',
  '🌸 Chậm lại một chút, rồi tiếp tục.',
  '🌸 Mình chọn bình an, ngay lúc này.',
  '🌸 Tâm từ với mình, rồi lan ra người khác.',
  '🌸 Thả lỏng vai… và thở.',
  '🌸 Cảm ơn cơ thể đã nâng đỡ mình.',
  '🌸 Đủ rồi. Tốt rồi. Tiếp thôi.',
  '🌸 Uống một ngụm nước, rồi quay lại nhé.'
];

// Gentle movement reminders (no pressure).
export const MINDFULNESS_STRETCH_REMINDERS = [
  '🌸 Đứng dậy 30 giây, thả lỏng vai và cổ nhé.',
  '🌸 Duỗi lưng: vươn tay lên cao 10 giây.',
  '🌸 Lăn vai 5 vòng chậm, hít thở sâu.',
  '🌸 Nhìn xa 20 giây để mắt được nghỉ.',
  '🌸 Chớp mắt chậm 10 lần, thư giãn một chút.',
  '🌸 Xoay cổ tay, duỗi các ngón tay 10 giây.',
  '🌸 Đổi tư thế ngồi, chỉnh lưng thẳng nhẹ nhàng.',
  '🌸 Đi lấy nước một chút nhé.',
  '🌸 Thả lỏng hàm, buông vai.',
  '🌸 Nếu thấy mỏi, dừng lại và hít thở 3 nhịp.'
];

/******************************************************************************
 * DEFAULT SITE LISTS [f13] [f04]
 ******************************************************************************/

// Default list of distracting sites
export const DEFAULT_DISTRACTING_SITES = [
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'reddit.com',
  'tiktok.com',
  'netflix.com',
  'spotify.com',
  'soundcloud.com',
  'vnexpress.net',
  'dantri.com.vn',
  'cafef.vn'
];

// Default list of sites blocked in Deep Work mode
export const DEFAULT_DEEPWORK_BLOCKED_SITES = [
  'discord.com',
  'messenger.com',
  'whatsapp.com'
];

/******************************************************************************
 * CLIPMD [f06]
 ******************************************************************************/

// Popup-to-background port name (used to detect popup close and cancel ClipMD inspect mode).
export const CLIPMD_POPUP_PORT_NAME = 'maizoneClipmdPopup';
