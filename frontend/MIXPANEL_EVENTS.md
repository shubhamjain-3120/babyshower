# Mixpanel Instrumentation Sheet

Wedding Invite MVP - Analytics Events Documentation

## Configuration

- **Project Token:** `0055aa3bfdfecd2baa52f21ddd74a998`
- **Autocapture:** Enabled (all clicks automatically tracked)
- **Session Replay:** Enabled (100% of sessions recorded)
- **User Identification:** Anonymous user IDs (persisted in localStorage)

---

## Custom Events

### Generation Flow Events

#### `generation_started`
Tracked when user initiates the wedding invite generation process.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dev_mode` | Boolean | Whether dev mode is active | `false` |
| `has_photo` | Boolean | Whether a photo was uploaded | `true` |

**Triggered in:** `App.jsx` → `handleGenerate()`
**Trigger point:** When user clicks "Generate" button after filling form

---

#### `generation_completed`
Tracked when wedding invite generation completes successfully.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dev_mode` | Boolean | Whether dev mode is active | `false` |

**Triggered in:** `App.jsx` → `handleGenerate()`
**Trigger point:** When video composition finishes and result screen loads

---

#### `generation_failed`
Tracked when wedding invite generation fails with an error.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `error_message` | String | Human-readable error message | `"No internet connection"` |
| `error_type` | String | Error type/category | `"NetworkError"` |

**Triggered in:** `App.jsx` → `handleGenerate()` catch block
**Trigger point:** When any step in generation pipeline fails

---

#### `generation_cancelled`
Tracked when user cancels an in-progress generation.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| _(none)_ | - | No parameters | - |

**Triggered in:** `App.jsx` → `handleCancel()`
**Trigger point:** When user clicks "Cancel" during loading screen

---

### User Action Events

#### `Page View`
Tracked when user views a specific screen/page.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `page_name` | String | Name of the screen viewed | `"result"` |

**Triggered in:** `ResultScreen.jsx` → `useEffect()`
**Trigger point:** On component mount (result screen loads)

**Note:** Mixpanel also auto-tracks page views via `track_pageview: true` config

---

#### `video_download` / `image_download`
Tracked when user downloads their generated invite.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| _(none)_ | - | No parameters | - |

**Triggered in:** `ResultScreen.jsx` → `handleDownloadInternal()`
**Trigger point:** When user clicks download button

---

#### `video_share` / `image_share`
Tracked when user shares their generated invite.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `share_method` | String | How the share was performed | `"native"` or `"whatsapp_fallback"` |

**Triggered in:** `ResultScreen.jsx` → `handleShare()`
**Trigger point:** When user clicks share button

---

#### `start_over`
Tracked when user clicks "Start Over" to create a new invite.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| _(none)_ | - | No parameters | - |

**Triggered in:** `ResultScreen.jsx` → button onClick
**Trigger point:** When user clicks "Start Over" button

---

## Automatic Events

### Autocapture Events
Mixpanel automatically captures the following without manual instrumentation:

- **All button clicks** - Includes element text, class, and position
- **Form submissions** - Captures form fields (non-sensitive only)
- **Page views** - URL changes and navigation
- **Session data** - Duration, page count, referrer

### Session Replay
- **Recording rate:** 100% of sessions
- **Captured data:** Mouse movements, clicks, scrolls, page interactions
- **Privacy:** Sensitive inputs automatically masked

---

## User Properties

Set on every session via `mixpanel.identify()` and `mixpanel.people.set()`:

| Property | Type | Description | Example |
|----------|------|-------------|---------|
| `distinct_id` | String | Persistent anonymous user ID | `"user_1738612345_abc123def"` |
| `$name` | String | Display name for user | `"Anonymous User"` |
| `first_seen` | ISO Date | When user first visited | `"2026-02-03T10:30:00.000Z"` |

**Storage:** User ID persisted in localStorage as `wedding_invite_user_id`

---

## Analytics Architecture

### Dual Analytics Setup
All events are sent to both:
1. **Mixpanel** - Primary analytics platform
2. **Google Analytics 4** - Backup analytics (if configured)

**Implementation:** `src/utils/analytics.js`

### Helper Functions

```javascript
// Track page views
trackPageView('screen_name', { optional_params })

// Track user actions
trackClick('event_name', { optional_params })
```

---

## Testing & Debugging

### Enable Debug Mode
Debug mode is enabled by default in `main.jsx`:
```javascript
mixpanel.init(token, { debug: true })
```

### Console Logs
Check browser console for Mixpanel debug output:
- `[Mixpanel] Tracking event: event_name`
- `[Mixpanel] People set`
- `[Mixpanel] Identifying user: user_id`

### Live View
Monitor events in real-time:
1. Go to Mixpanel dashboard
2. Navigate to "Events" → "Live View"
3. See events as they arrive

---

## Key Metrics to Track

### Conversion Funnel
1. Page View (landing)
2. `generation_started`
3. `generation_completed`
4. `video_download` or `video_share`

### Success Rate
- `generation_completed` / `generation_started` = Success rate
- `generation_failed` / `generation_started` = Failure rate

### User Engagement
- Download rate: `video_download` / `generation_completed`
- Share rate: `video_share` / `generation_completed`
- Return users: Users with multiple `generation_started` events

---

Last Updated: 2026-02-03
