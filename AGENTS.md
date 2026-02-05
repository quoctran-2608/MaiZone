# Mai Extension Development Guidelines

> Target runtime: **Chrome Extension MV3** (background = service worker), repo ưu tiên **không bundler**.

## Architecture & Design
- **Core Principles**
  - Single responsibility principle
  - Clean data flow between components
  - Minimal dependencies with clear interfaces
  - Feature-driven modularization
- **Current Architecture (source of truth)**
  - `background_state.js`: state runtime + MV3 init gating + broadcast
  - `state_core.js`: schema + sanitize/invariants/diff (pure functions, dùng chung)
  - `state_contract.js`: allowlists/contract cho get/update state giữa UI/background/content
  - `state_helpers.js`: UI get/update state (message first, fallback storage **đã sanitize**)
  - `actions.js`: `messageActions` constants (không hardcode string rải rác)
  - `actions_global.js`: `MAIZONE_ACTIONS` (classic) cho `content.js` để tránh drift string actions
  - `messaging.js`: `sendMessageSafely()`/`sendMessageToTabSafely()` có timeout + handle invalidation
  - `background_omnibox.js`: omnibox keyword `mai` → lệnh nhanh (on/off, deepwork, mind, clip)
  - `background_clipmd.js` + `clipmd_offscreen.*`: tiện ích **ClipMD** (chọn element -> HTML -> Markdown)
  - `content.js`: **classic script** (không dùng `import`), tối giản footprint + privacy-first
- **File Organization**
  - Flat and minimal file structure
  - Modular organization within files using section comments
  - Separate concerns but maintain cohesion between related functionality

## Code Structure & Style
- **Module Pattern**
  - Use ES6 module imports/exports consistently (background/popup/options/helpers)
  - **Content script**: phải là classic script (không `import`/`export` ở top-level).
  - Export only what's necessary (minimize public API)
  - Modular sections within files using (chọn 1 style, consistent trong file):
    - `/***** SECTION NAME *****/`
    - hoặc banner block comment `/* ... */` cho section lớn
- **Naming Conventions**
  - camelCase for variables and functions
  - Descriptive names reflecting purpose and content
  - Clear action verbs for functions (handle*, toggle*, load*, init*, etc.)
  - Consistent naming patterns across related functions
- **Formatting**
  - Consistent indentation (2 spaces)
  - Line breaks between logical sections
  - Group related functions together

## Error Handling & Messaging
- **Error Management**
  - Always check for null/undefined objects before accessing properties
  - Use try/catch blocks for async operations and initialization
  - Provide sensible defaults for missing state
  - Handle extension context invalidation gracefully
- **MV3 Reliability Rules (P0)**
  - Mọi handler có thể wake SW (alarms/webNavigation/onMessage) phải gọi `ensureInitialized()` trước khi rely vào state.
  - Với `chrome.runtime.onMessage.addListener` xử lý async: luôn `return true` để giữ message channel mở.
  - Tránh `setInterval/setTimeout` dài hạn trong SW; dùng `chrome.alarms` cho timer core.
  - Khi feature không active: clear alarms để tránh SW bị wake vô hạn (battery/cpu).
- **Message Passing**
  - Use sendMessageSafely helper for all inter-component communication
  - Implement timeouts to prevent hanging (setTimeout hoặc Promise.race)
  - Add fallbacks when communication fails:
    - Check chrome.runtime.id to detect invalid extension contexts
    - Fall back to chrome.storage.local when background connections fail
  - **State broadcast contract**
    - `stateUpdated` ưu tiên dùng `{ delta }` (có thể giữ `{ state }` alias tạm thời cho backward compatibility)
  - **Payload validation**
    - Luôn validate `message.action` là string + validate shape của `payload/data` trước khi xử lý
  - **Fallback storage write (P0)**
    - Không bao giờ `chrome.storage.local.set(payload)` trực tiếp từ UI.
    - Fallback bắt buộc chạy sanitize + invariants + diff (`state_core.js`) và chỉ set **delta**.
- **Logging**
  - Emoji prefixes for console messages:
    - 🌸 (single) cho thông báo thông thường và logs
    - 🌸🌸🌸 (triple) CHỈ dùng cho thông báo lỗi và exceptions
  - Meaningful log messages that aid debugging
  - Không log nội dung người dùng nhập (privacy).

## Documentation & Features
- **Code Documentation**
  - JSDoc style comments for all functions
  - Describe parameters, return values, and side effects
  - Document security considerations and limitations
- **Feature Tagging System**
  - Always maintain `FIT` (Feature Indexing Table) in README.md
  - Tag files and functions using: `@feature f01 - Feature Name` 
  - For multi-feature files/functions, include all relevant tags
  - Update feature tables when adding/modifying functionality
  - Example:
    ```javascript
    /**
     * Module description
     * @feature f01 - Feature Name
     */
    
    /**
     * Function description
     * @feature f01 - Feature Name
     */
    function exampleFunction() {
      // Implementation
    }
    ```

## User Experience & Security
- **User Interface**
  - Vietnamese language for all user-facing messages
  - Minimal and non-intrusive notifications
  - Maintain distraction-blocking as a core feature
  - Keep user relaxed and happy (positive messaging)
  - Tránh spam UI: debounce/cooldown khi cảnh báo nhiều lần trong thời gian ngắn.

- **Security Practices** 
  - Follow Chrome extension best practices
  - Avoid over-permissions
  - Sanitize user inputs
  - Document security limitations
  - **Privacy-first**
    - Không đọc `input[type="password"]`
    - Không lưu text người dùng gõ (chỉ lưu metadata nếu thật sự cần, ví dụ length)
    - Không gửi dữ liệu ra ngoài (no analytics/LLM keys/Gemini)
  - Nếu sau này bắt buộc lưu dữ liệu nhạy cảm: cân nhắc encrypt, nhưng ưu tiên thiết kế để không cần lưu.

## Quick Checks (Dev)
- JS syntax check:
  - ESM files: `node --input-type=module --check < file.js`
  - Content script (classic): `node --check content.js`

- Unit tests (no deps/bundler):
  - `npm test` (preferred)
  - `node --test` (equivalent)

- Smoke test (manual):
  - **Reload extension (không reinstall)** tại `chrome://extensions` (Developer mode → Reload)
  - **Tab mới**: mở `https://facebook.com` (hoặc domain chắc chắn nằm trong `distractingSites`) → trang hỏi lý do phải xuất hiện
  - **Tab cũ** (đã mở trước khi reload): navigate tới cùng domain → trang hỏi lý do vẫn phải xuất hiện
  - **Toggle state**: tắt `intentGateEnabled` → reload trang → không hiện trang hỏi lý do; bật lại → reload → hiện lại
  - **MV3 cold start**: “Inspect views / Service worker” → **Stop** service worker, rồi mở lại `https://facebook.com` để chắc chắn SW wake + intent gate vẫn hoạt động
