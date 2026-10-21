# Public Google Calendar authorization

Cloud project: `universal-task-manager-507219`. Inspection: 21 October 2026.

## Observed configuration

- Audience: External, **Testing**, one listed test user. Publish app is disabled until Branding is complete.
- Branding: app name and support contact set; authorized domain is `nebuhtit.github.io`; homepage, privacy policy and terms URLs are empty.
- Web client: `862892546789-3t1h7tmbjvtv41jtp38v0dfmngfkt5n3.apps.googleusercontent.com`. The deployed origin `https://nebuhtit.github.io` is already authorized, alongside the existing local development origins. This browser token flow does not need a server redirect URI.
- Native client: `862892546789-7u2j6n2tkbjs4lp5rqe84t8ecgaktd00.apps.googleusercontent.com`.
- Data Access already contains the three scopes requested by the app. `calendar.readonly` and `calendar.events` are sensitive; `calendar.calendarlist.readonly` is non-sensitive. No restricted scopes are listed.
- Verification Center says verification is not required **while Testing**; this is not production approval.

## Prepared public URLs (publish only after owner approves privacy text)

- Homepage: `https://nebuhtit.github.io/universal-task-manager/about.html`
- Privacy: `https://nebuhtit.github.io/universal-task-manager/privacy.html`

Source files: `apps/web/public/about.html` and `apps/web/public/privacy.html`.
The shared installation guide links to both pages from entry Help and Settings.
The policy includes the developer contact and the Google Limited Use commitment; the owner must approve these statements before publication. Terms of service should not point to an invented or nonexistent document.

## Scope justifications for Google's verification form

### https://www.googleapis.com/auth/calendar.readonly

Universal Task Manager lets the user select their Google calendars and display events alongside local tasks. It reads calendar metadata and event titles, descriptions, locations, dates, time zones, recurrence and availability to render the user's calendar, calculate busy time, and place tasks within linked reserved intervals. Requests go directly from the user's device to Google; data is cached in that user's local workspace. This read-only scope supports users who do not authorize event editing. No developer-hosted calendar database is used.

### https://www.googleapis.com/auth/calendar.events

After the user separately authorizes write access, Universal Task Manager creates and updates Google events linked to their UTM items, edits event timing and properties, moves events between the user's writable calendars, and deletes linked Google events when the user removes or detaches them. Access to shared writable calendars is required; limiting access to owned calendars would exclude supported calendars shared with the user. The app checks the connected account and calendar write permission and uses pending operations and conflict handling to recover interrupted saves.

### https://www.googleapis.com/auth/calendar.calendarlist.readonly

The app lists the calendars available to the connected user, including calendar names, display colors, time zones and access roles. The user selects calendars to display and a writable destination for linked events. The app does not use this scope to subscribe the user to new calendars or change calendar sharing.

## Remaining publication steps

1. Publish the public pages with the policy accurately stating that the public Cloudflare delivery service is not operational; confirm they load without workspace login. Push service setup is deferred and is not a prerequisite for Google authorization. Its retention/deletion changes remain local.
2. Save the homepage and privacy URLs in Branding.
3. Verify the authorized domain in Google Search Console. Google's current OAuth domain-verification guidance requires a DNS-level Domain property, not merely a URL-prefix property. A `github.io` Pages subdomain does not give this project DNS control; public verification may require an owner-controlled custom domain and its TXT verification record. Do not claim a path-level HTML verification satisfies that requirement.
4. Switch Audience to In production through the console's publication flow. Review its warning before the final action.
5. In Verification Center, provide the sensitive-scope justifications and an accessible demonstration video showing consent, calendar selection, reading events and authorized event editing. Submit required attestations only after the owner reviews them.
6. Google performs the external review. Before approval, production can still show an unverified-app warning and a lifetime user cap; it is not equivalent to unrestricted verified access.
7. Once approved, test with a separate consenting user's account. Confirm the account identity, selected calendar list, read access, optional write consent and disconnect behavior. Do not alter production calendar events as a test without that user's approval.

## Sources

- https://support.google.com/cloud/answer/15549945
- https://support.google.com/cloud/answer/13464321
- https://support.google.com/cloud/answer/13461325
- https://support.google.com/cloud/answer/13807376
- https://developers.google.com/terms/api-services-user-data-policy

Do not change Google sync algorithms, OAuth client IDs or requested scopes merely to lift the Testing audience restriction.
