/**
 * MaiZone Browser Extension
 * Exercise Gate UI: collect reps to unlock browser
 * @feature f14 - Exercise Reminder
 */

import { sendMessageSafely } from './messaging.js';
import { messageActions } from './actions.js';

const pushupsEl = document.getElementById('pushups');
const situpsEl = document.getElementById('situps');
const squatsEl = document.getElementById('squats');
const submitEl = document.getElementById('submit');
const errorEl = document.getElementById('error');
const statPushupsEl = document.getElementById('stat-pushups');
const statSitupsEl = document.getElementById('stat-situps');
const statSquatsEl = document.getElementById('stat-squats');
const heroTitleEl = document.getElementById('hero-title');
const heroSubtitleEl = document.getElementById('hero-subtitle');
const motivationEl = document.getElementById('motivation');

const FUNNY_TITLES = [
  { title: '🦵 Chân đang phản đối việc ngồi quá lâu!', subtitle: 'Đứng dậy đi, đừng để chân nó đình công!' },
  { title: '💀 Xương sống gửi lời kêu cứu khẩn cấp!', subtitle: 'Cột sống đang cong như dấu hỏi rồi!' },
  { title: '🐌 Não đang chạy chậm như ốc sên...', subtitle: 'Cần oxygen gấp! Vận động để não chạy turbo!' },
  { title: '🍑 Mông đang bẹp dí như bánh tráng!', subtitle: 'Cứu lấy vòng 3 trước khi quá muộn!' },
  { title: '🪑 Ghế đang xin được nghỉ ngơi!', subtitle: 'Bạn ngồi lâu quá, ghế cũng mệt rồi!' },
  { title: '🩸 Máu đang ùn tắc như đường giờ cao điểm!', subtitle: 'Vận động để máu lưu thông trở lại!' },
  { title: '🧟 Cơ thể đang biến thành zombie văn phòng!', subtitle: 'Tập thể dục để trở lại làm người!' },
  { title: '🦴 Các khớp đang kêu cót két!', subtitle: 'Bôi trơn bằng vận động ngay thôi!' },
  { title: '🧊 Chân đang đông cứng như que kem!', subtitle: 'Làm tan băng bằng vài cái squat nào!' },
  { title: '🐙 Tư thế ngồi đang giống bạch tuộc!', subtitle: 'Duỗi thẳng người ra, bạn là người mà!' },
];

const MOTIVATIONS = [
  '💡 Mỗi cái chống đẩy là một bước gần hơn tới body trong mơ... hoặc ít nhất là hết đau lưng!',
  '🧠 Nghiên cứu cho thấy: tập thể dục giúp thông minh hơn. Bugs sẽ sợ bạn!',
  '🦸 Không cần cape để làm siêu anh hùng. Chỉ cần 10 cái squat!',
  '🎮 Coi như đây là mini-game. Hoàn thành để unlock màn tiếp theo!',
  '☕ Tập xong uống cà phê ngon hơn 69%. Khoa học chứng minh. Có thể.',
  '🌟 Cơ thể bạn là phương tiện duy nhất không thể đổi mới. Hãy bảo trì nó!',
];

const BUTTON_TEXTS = [
  '🔓 Xong rồi, thả tôi ra!',
  '🏃 Tập xong, chuồn thôi!',
  '💪 Đủ rồi, mở cửa đi!',
  '🎉 Xong! Trả lại tự do!',
  '🚀 Nạp năng lượng xong, bay thôi!',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function initFunnyContent() {
  const content = pickRandom(FUNNY_TITLES);
  if (heroTitleEl) heroTitleEl.textContent = content.title;
  if (heroSubtitleEl) heroSubtitleEl.textContent = content.subtitle;
  if (motivationEl) motivationEl.textContent = pickRandom(MOTIVATIONS);
  if (submitEl) submitEl.textContent = pickRandom(BUTTON_TEXTS);
}

initFunnyContent();

function parseCount(el) {
  const raw = typeof el?.value === 'string' ? el.value.trim() : '';
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function setError(message) {
  if (!errorEl) return;
  if (!message) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    return;
  }
  errorEl.style.display = 'block';
  errorEl.textContent = message;
}

const REP_COMMENTS = [
  { min: 5, messages: ['🐣 Ít nhất cũng động đậy rồi!', '🦥 Hơn con lười một chút!', '🌱 Có còn hơn không!'] },
  { min: 10, messages: ['🏃 Nhanh hơn wifi công ty rồi đấy!', '🐢 Vượt qua tốc độ rùa thành công!', '💺 Ghế đang ghen tị với sàn nhà!', '🦴 Xương khớp: "Cảm ơn ông chủ!"', '🧠 Não vừa được tưới oxygen!', '🔋 Pin sạc được 10%!'] },
  { min: 15, messages: ['🏆 Cơ bắp cảm ơn bạn!', '⚡ Năng lượng tràn đầy!', '🌟 Tuyệt vời!'] },
  { min: 20, messages: ['🦸 Quái vật!', '👑 Huyền thoại!', '🚀 Siêu nhân!'] },
];

function getRepComment(total) {
  for (let i = REP_COMMENTS.length - 1; i >= 0; i--) {
    if (total >= REP_COMMENTS[i].min) {
      return pickRandom(REP_COMMENTS[i].messages);
    }
  }
  return '';
}

function updateRepFeedback() {
  const total = parseCount(pushupsEl) + parseCount(situpsEl) + parseCount(squatsEl);
  const comment = getRepComment(total);
  if (motivationEl) {
    motivationEl.textContent = comment || pickRandom(MOTIVATIONS);
  }
}

function normalizeNumericInput(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    const next = String(el.value || '').replace(/[^0-9]/g, '');
    el.value = next.length ? String(Number(next)) : '0';
    updateRepFeedback();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitEl?.click();
    }
  });
}

normalizeNumericInput(pushupsEl);
normalizeNumericInput(situpsEl);
normalizeNumericInput(squatsEl);

function updateTodayStats(stats) {
  if (!stats) return;
  if (statPushupsEl) statPushupsEl.textContent = `Hôm nay ${stats.pushUps || 0}`;
  if (statSitupsEl) statSitupsEl.textContent = `Hôm nay ${stats.sitUps || 0}`;
  if (statSquatsEl) statSquatsEl.textContent = `Hôm nay ${stats.squats || 0}`;
}

async function loadTodayStats() {
  const res = await sendMessageSafely(
    { action: messageActions.exerciseGetState },
    { timeoutMs: 3000 }
  );
  if (res?.todayStats) {
    updateTodayStats(res.todayStats);
  }
}

loadTodayStats();

submitEl?.addEventListener('click', async () => {
  setError('');

  const pushUps = parseCount(pushupsEl);
  const sitUps = parseCount(situpsEl);
  const squats = parseCount(squatsEl);

  if (pushUps + sitUps + squats <= 0) {
    setError('Bạn cần nhập ít nhất 1 lần cho một bài tập.');
    return;
  }

  submitEl.disabled = true;

  // Confetti celebration first!
  launchConfetti();
  setError('');

  // Delay to let user enjoy the confetti, then submit
  await new Promise((r) => setTimeout(r, 1500));

  const res = await sendMessageSafely(
    { action: messageActions.exerciseSubmit, data: { pushUps, sitUps, squats } },
    { timeoutMs: 6000 }
  );

  if (!res?.success) {
    submitEl.disabled = false;
    setError('Chưa ghi nhận được. Hãy thử lại.');
    return;
  }

  // Gate will be closed by background
});

function launchConfetti() {
  const colors = ['#FFD93D', '#FF6B6B', '#FF8E53', '#4ECDC4', '#A78BFA', '#34D399'];
  const confettiCount = 50;
  
  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div');
    confetti.style.cssText = `
      position: fixed;
      width: ${Math.random() * 10 + 5}px;
      height: ${Math.random() * 10 + 5}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      left: ${Math.random() * 100}vw;
      top: -20px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      animation: confetti-fall ${Math.random() * 2 + 2}s linear forwards;
    `;
    document.body.appendChild(confetti);
    
    setTimeout(() => confetti.remove(), 4000);
  }
  
  // Add keyframes if not exists
  if (!document.getElementById('confetti-style')) {
    const style = document.createElement('style');
    style.id = 'confetti-style';
    style.textContent = `
      @keyframes confetti-fall {
        to {
          top: 100vh;
          transform: rotate(${Math.random() * 720}deg);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
