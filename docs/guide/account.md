# Account page

- `pages/AccountPage` (`#/account`; `routeSection` null, so the navigation highlights nothing) is the one place for account management: `account/AccountSection` cards, each an h2 under the page's one h1, Delete account last. A feature adds another `AccountSection` (Buddies comes after Password), never a second h1.
- Reached from the account control: the wide header's name link and the phone menu's Account entry, both with `aria-current` on the page.
- A guest gets `SignInEmpty`; while the session settles the loading state shows, so a reload never flashes it.
- Name and email are read-only (the API has no profile update).
- Password change and deletion open from the page's buttons: disabled offline, each with its `OfflineNote`; the dialogs' state stays in the controller; focus returns to the button. Sign out works offline.
- The footer keeps only site-level items: never an account action there.
- The terms say where deletion is (`terms.section.account.body`).

Profile picture (backend "Profile pictures"; `avatars/ProfilePicture`, `avatars/AvatarCropDialog`, `lib/avatars/`; the crop stage, gestures, decoding and math are shared with the photo focus: `common/CropStage`, `lib/images/crop*.ts`, upload "Focus"):

- Always on the screen, with or without a picture: the visibility notice `account.avatar.visible` (there is no checkbox, so the text must be unmissable), the content rule `account.avatar.rule` and a link to the terms.
- Save is `canSaveAvatar({ noticeShown, ready, online, busy })`: nothing is sent before the notice is on the screen of the crop dialog. Keep the notice inside the dialog and never remove that gate.
- Limits: `avatarFileProblem` refuses an empty file, a non-image and one over 40 MB at the section, without a dialog (the browser decodes it, so the limit is not the API's 12 MB); `sourceProblem` refuses above `MAX_CROP_SOURCE_PIXELS` (50 MP) or below `MIN_CROP_SOURCE_SIDE` (64 px on the short side).
- The header size (`readImageSize`: PNG, JPEG, GIF, WebP, from the first 1 MiB, `HEADER_BYTES`) is checked BEFORE `createImageBitmap(file)`: a decoded picture takes 4 bytes per pixel, so 100 MP can end a phone's tab. A format without a readable header is checked on the decoded bitmap (too late for the memory, still refused).
- Decode with `openCropSource` (`createImageBitmap`, upright by EXIF; a bitmap above `MAX_JPEG_PIXELS` is drawn down once), never a blob URL; an unreadable file shows `account.avatar.unreadable` and cannot be sent. The stage paints the very window it will send on a `<canvas>` (`crop-render.ts`), never with an inline `style` (the CSP forbids it); the sent pixels do not depend on the canvas size (`stagePixels`).
- HEIC/HEIF (`looksHeic`: type or name, since iOS sends an empty type; `avatarFileProblem` lets it pass the chooser): `readableSource` converts first (the upload dialog's `convertHeic`: an upright JPEG of at most 4096 × 4096 px), then the JPEG takes the same checks. The original is never decoded or sent; one the browser cannot convert shows `upload.reason.heic`.
- The crop window is the pure `lib/images/crop.ts` with the square `AVATAR_SHAPE` (`avatar-crop.ts`): zoom 1 to 4 of the short side, always inside the picture, never under `MIN_WINDOW` (64 source pixels); the output is at most 512 px and never enlarged.
- Pointer: one pointer drags, two pinch about the fingers' midpoint (`pinchTo`: the point under it stays under it, so a moving midpoint pans); the stage has `touch-action: none`, so the browser leaves these gestures to the dialog.
- Keyboard: the arrows move the picture as a drag would, + and - zoom. The keys feed a polite, visually hidden `role="status"` region that is always in the dialog, through `crop-announce.ts` `createAnnouncer` (the first message at once, then at most one per 700 ms, always the latest: keys repeat).
- `AvatarCropDialog` is a `sheet` on phones with Save and Cancel sticky at its foot; focus starts on the positioning stage (`initialFocus=".crop-stage"`), not on Close.
- Take photo (`capture="user"`) shows below 45em only, CSS-hidden above, like `UploadDialog`.
- Failures show in the dialog (form `avatar`; a `toBlob` that gives nothing shows `account.avatar.processFailed` and keeps it open), or at the section after a removal; closing a dialog calls `clearFormError`.
- `app.uploadAvatar` and `app.removeAvatar` (a 404 counts as removed) only patch `user.avatarId` (and the saved `lastUser`) and drop the replaced picture's saved copies (`dropCachedImages` of both sizes): nothing reloads. `readLastUser` fills a missing `avatarId` with null.
- Online only, with `OfflineNote`; the picture itself stays visible offline. After Remove, focus moves to the chooser (the Remove button leaves).

Password change (`account/ChangePasswordDialog`):

- Fields carry `autocomplete` `current-password`/`new-password`, plus a `hidden` `username` field holding the address for password managers (`FIRST_FIELD` skips it); no show/hide toggle, like every other password field.
- `lib/api/password-change.ts` `passwordChangeProblem` refuses a mismatch, an unchanged password and more than 72 UTF-8 bytes before sending; the server stays authoritative.
- `auth/AccountLink` (reset and activation links, the mail-free set-up) refuses the same before sending (`newPasswordProblem`: mismatch, 72 bytes) and carries the hidden `username` field where the app knows the address (set-up).
- `app.changePassword` (form `password-change` while the dialog is open, else the error toast) calls `resetCsrf()` after the answer, because the server renews this session's ID and CSRF token. The account stays signed in and nothing reloads; the server signs out the other devices.

Display names:

- Shown whole and wrapped (`overflow-wrap: anywhere`) everywhere; never shorten a name that fits.
- The one clipped place is the fixed-width wide header (`HeaderAccount`; the link's accessible name `header.accountLink` starts with the name): `lib/layout/first-name.ts` `firstName` only while the measured whole name does not fit, the full name in `title` and a visually hidden copy; a single long word falls back to the ellipsis. A new place that clips a name does the same.
