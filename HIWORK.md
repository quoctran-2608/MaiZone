# Cách Hoạt Động - Kiến Trúc Tiện Ích Mai

Những tên file chuẩn khi xây dựng browser extension:

- `background.js`: Script chạy nền
- `content.js`: Script tương tác với trang web
- `popup.html`/`popup.js`: Giao diện khi click vào biểu tượng extension
- `options.html`/`options.js`: Trang cài đặt cho extension

## Content Script và Background Script

`content.js` theo dõi thao tác người dùng và hiển thị giao diện, trong khi `background.js` xử lý logic và điều phối các chức năng.

### `content.js`
- **Phạm vi**: Chạy trong trang web người dùng đang truy cập, truy cập DOM
- **Nhiệm vụ**: Theo dõi sự kiện (nhập liệu, focus), hiển thị UI, gửi dữ liệu đến `background.js`
- **Vòng đời**: Tải khi người dùng truy cập trang web phù hợp
- **Giao tiếp**: Gửi/nhận message từ background.js, truy cập chrome.storage
- **API**: Truy cập hạn chế API Chrome, chủ yếu tương tác với trang web

### `background.js`
- **Phạm vi**: Chạy ở nền, độc lập với trang web
- **Nhiệm vụ**: Quản lý trạng thái, xử lý logic (nhắc nghỉ, hỏi lý do trước khi mở trang), lưu trữ cài đặt
- **Vòng đời**: MV3 Service Worker (có thể ngủ/được đánh thức theo event: message, webNavigation, alarms...)
- **Giao tiếp**: Tương tác với tất cả content scripts, quản lý API trình duyệt
- **API**: Truy cập đầy đủ API Chrome (tabs, storage, alerts, network)

## Luồng Dữ Liệu

```
+-------------+         +----------------+         +--------------+
|  Thao tác   | ------> |  content.js    | ------> | background.js|
|  Người dùng |         |                |         |              |
+-------------+         +----------------+         +--------------+
      ^                        |                         |
      |                        v                         v
+-------------+         +----------------+         +--------------+
|  Trang Web  | <------ |  Giao diện UI  | <------ |  Lưu trữ     |
+-------------+         +----------------+         +--------------+
```

1. Người dùng tương tác với trang web
2. `content.js` ghi nhận sự kiện (gõ phím, focus)
3. Dữ liệu được gửi đến `background.js` để xử lý
4. background.js xử lý logic và cập nhật lưu trữ
5. Kết quả trả về `content.js`
6. `content.js` cập nhật giao diện người dùng

## Hệ Thống Truyền Tin

Extension sử dụng hệ thống truyền tin để giao tiếp giữa các thành phần:

```javascript
// Từ intent_gate.js đến background.js
sendMessageSafely({
  action: 'intentGateAllowAccess',
  data: { tabId, reason }
});
```

## Popup và Trang Cài Đặt

### Popup (`popup.html`, `popup.js`)
- **Phạm vi**: Hiển thị khi click vào biểu tượng extension
- **Nhiệm vụ**: Hiển thị trạng thái, cung cấp điều khiển nhanh, thống kê ngắn gọn
- **Tương tác**: Đọc trạng thái từ storage, gửi lệnh đến `background.js`

### Trang Cài Đặt (`options.html`, `options.js`)
- **Phạm vi**: Trang cấu hình đầy đủ
- **Nhiệm vụ**: Quản lý tất cả cài đặt, cấu hình chi tiết các tính năng
- **Lưu trữ**: Lưu cài đặt vào chrome.storage.sync hoặc chrome.storage.local

## Omnibox Commands (f11) — Gõ `mai␠` trên address bar

- **Bật**: khai báo trong `manifest.json`:
  - `"omnibox": { "keyword": "mai" }`
- **Cách dùng**: gõ `mai` + Space/Tab → nhập lệnh → Enter.
- **Lệnh hỗ trợ**:
  - `on` / `off`: bật/tắt hỏi lý do khi mở web sao nhãng
  - `deepwork 40 [task]`: bắt đầu Deep Work với số phút tuỳ chọn (1–1440); `[task]` có thể bỏ trống
  - `stop`: dừng Deep Work (reset task + timer)
  - `mind on` / `mind off`: bật/tắt nhắc mindfulness
  - `clip`: bật ClipMD (chọn element → copy Markdown)
- **UX feedback**: ưu tiên toast in-page (`maiToast`) trên tab http/https đang active; nếu không gửi được thì fallback sang notification hệ thống.
- **MV3 reliability**: omnibox event có thể wake service worker, nên handler gọi `ensureInitialized()` trước khi đọc state.

## ClipMD (f06) — Copy Markdown bằng chọn vùng

- **Mục tiêu**: Bấm shortcut → chọn (pick) 1 element trên trang → chuyển HTML → Markdown → copy vào clipboard.
- **Picker**: Ưu tiên dùng **inspect overlay kiểu DevTools** (CDP qua `chrome.debugger`) để UX chọn vùng giống `AnswerDotAI/clipmd`.
- **Fallback**: Nếu trình duyệt không hỗ trợ/không cho phép `debugger` hoặc `offscreen`, Mai sẽ fallback sang chế độ chọn element bằng click-capture trong `content.js` (UX có thể khác).

### Luồng hoạt động (Markdown)

1. User bấm **Alt+Q** hoặc click icon MaiZone (mở popup).
2. `background_clipmd.js` bật inspect overlay (chế độ chọn node).
3. User click element → background lấy `outerHTML` của element.
4. `clipmd_offscreen.js` convert HTML → Markdown (Turndown).
5. Background ghi Markdown vào clipboard (trong context của tab).

## Huy hiệu thời gian (f03/f04) — mm:ss trên icon

- **Vì sao cần?** MV3 Service Worker có thể ngủ; không nên chạy `setInterval` mỗi 1 giây trong SW vì sẽ wake liên tục (tốn pin/CPU).
- **Cách làm**: Dùng `chrome.alarms` để hẹn giờ kết thúc (end alarm) và tick badge (fallback có thể wake SW mỗi giây, tuỳ trình duyệt).
- **High-precision (mỗi giây)**: Khi đang Deep Work, Mai tận dụng `chrome.offscreen` (cùng offscreen với ClipMD) để tick badge mỗi 1 giây; ticker tự dừng khi Deep Work kết thúc.
- **Triển khai**: `background_breakReminder.js` đảm bảo offscreen doc tồn tại; `clipmd_offscreen.js` đọc state từ `chrome.storage.local` và cập nhật badge (không log nội dung task).
- **Vì sao có thể tốn pin/không mượt?** Không có `offscreen` thì muốn badge nhảy từng giây phải wake MV3 service worker theo `chrome.alarms`, nên có thể bị throttle/clamp tuỳ trình duyệt.

## Mindfulness Reminders (f08) — Toast + chuông nhẹ

- **Timer MV3**: `background_mindfulnessReminder.js` dùng `chrome.alarms` mỗi 15 phút, skip khi đang Deep Work (`isInFlow=true`), và gửi message sang tab active để hiển thị toast.
- **Toast hiển thị**: `content.js` nhận action `mindfulnessToast` và render toast (in-page), không dùng notification hệ thống để tránh làm user giật mình quá mức.
- **Chuông (Web Audio) và giới hạn autoplay**:
  - Chrome **không cho** `AudioContext` start/resume nếu **không có user gesture** (click/keydown) trên trang.
  - Vì vậy Mai chỉ “unlock” audio sau **lần click/keydown đầu tiên** trên mỗi trang; trước đó toast sẽ **im lặng** (để tránh spam lỗi console kiểu “AudioContext was not allowed to start...”).
  - Nếu muốn đảm bảo luôn có âm báo dù user chưa tương tác trang, cần chuyển sang notification hệ thống (âm do OS/browser quyết định) thay vì Web Audio.

## Tổng Quan Kiến Trúc

```
+----------------+
|  Giao diện     |
|  Extension     |
+-------+--------+
        |                        
        |        +----------------+      +------------------+
        |        |                |      |                  |
+-------v----------------+  +-----v-------------+  +--------v---------------+
|                        |  |                   |  |                        |
|  popup.js/popup.html   |  |  options.js/html  |  |    background.js       |
|  (Điều khiển nhanh)    |  |  (Cài đặt đầy đủ) |  |    (Logic xử lý)       |
+-----------+------------+  +--------+----------+  +------------+-----------+
            |                        |                          |
            |                        |                          |
            +------------------------+--------------------------+
                                     |
                                     | Truy cập lưu trữ
                          +----------v------------+
                          |                       |
                          |  chrome.storage       |
                          |  (Cài đặt người dùng) |
                          |                       |
                          +-----------------------+
                                     |
                          +----------v------------+
                          |                       |
                          |     content.js        |
                          |   (Tương tác trang)   |
                          |                       |
                          +-----------------------+
```
