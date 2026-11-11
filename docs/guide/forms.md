# Forms

- `mutate(…, notice, form)` sets `formError` (`{form, message}`) instead of the error toast (which keeps load and connection errors). The form shows it at its submit (`common/FormError`, focused, `role="alert"`) or at the field (`glazeErrorField`); it clears on the next submit, a page change and an account change.
- A dialog's or section's own refusal (a picture file the avatar section refuses) is a `FormError` too, its key's placeholders in `values`, never a hand-made alert box. Field errors tied by `aria-describedby` stay with their field.
- A dialog shows only its own form's error, never `AppState.error` (a failed load meanwhile would appear in it and take its focus): the terms, account-deletion, photo-removal and glaze-removal dialogs read `formErrorFor` with `terms`, `account-delete`, `image-remove` and `glaze-remove`.
- Reads for a dialog or page (`query`: invite preview, deletion log) report the same way and answer null after a failure or an account change.
- Club sections name their form per club (`clubForm`; a member's role error shows at that member's row).
- Components never import `api`: the public sign-in options (`AppState.authOptions`, loaded once, retried by `openAuth`) reach the sign-in dialog, footer contact and terms views as props.
- Every form shows `common/OfflineNote` above its disabled submit; offline stars stay focusable with `aria-disabled`.
- `ModalShell` without `onClose` is blocking.
- `ModalShell` focuses Close when it opens; a form dialog (`AuthDialog`, `DeleteAccountDialog`, `ChangePasswordDialog`) passes `initialFocus={FIRST_FIELD}` (`ui/first-field.ts`, a selector: the first enabled text-like field that is not `hidden`) to start at its first field, and Escape still returns focus to the opener.
- `errorText` reads an unknown server message as `errors.requestFailed`, and as `errors.invalidForm` only when it names a field (`field: text`); a new API text gets its line in `server-messages.ts`.
- A write that navigates after its answer (`saveCombination`, `removeCombination`, `removeGlaze`) does so only while `ctx.visit()` is the one it started in, and names its form only then (else the banner shows the failure).
