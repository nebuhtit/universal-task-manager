# Timeline weather beta

Enable **Settings → Weather → Timeline background: sun and precipitation (beta)**, then choose a city, enter coordinates, or explicitly request browser geolocation. The beta is off by default. Its master switch immediately removes both layers and stops forecast requests; the precipitation switch independently stops forecasts. Coordinates do not change the calendar time zone.

The device-local `utm:weather:v1` settings and `utm:weather-cache:v1` cache are separate from encrypted workspace records, backups and Google synchronization. They contain the selected location and forecast. Requests send coordinates to Open-Meteo; city search sends the query to its geocoding service. No account or API key is required for this personal-use integration. Review provider terms before commercial distribution.

SunCalc 1.9.0 is pinned for its established API (BSD-2-Clause, no runtime dependencies). Its license ships in `public/suncalc-license.txt`. The local solar adapter gathers adjacent solar cycles and clips to UTM civil-day bounds, handling zone differences and DST. Invalid dates for absent polar transitions are omitted; solar altitude still determines the background. Calculations are approximate astronomical times, not terrain/horizon-aware observations.

A single App-owned service runs only while a workspace is open. Forecasts refresh at startup and hourly using the real clock, with foreground catch-up. The browser cannot guarantee execution while a phone sleeps. Requests time out after 15 seconds, deduplicate and discard obsolete responses. Probabilities refer to the preceding hour. Missing data is not zero probability; rendering clips strictly to covered intervals. Cached forecasts expire six hours after successful retrieval. Errors appear only in weather settings.

Solar/haze layers use existing timeline segments; hidden sleep is not painted. Tokens in `styles/tokens.css` own both palettes. No task dates, scheduling, occupancy or workspace schema are modified.

## Repeatable checks

- `pnpm exec vitest run apps/web/src/features/weather/weather.test.ts apps/web/src/features/calendar/timeline.test.tsx apps/web/src/features/calendar/timelinePlanning.test.ts`
- `pnpm exec playwright test tests/e2e/weather.spec.ts`
- `pnpm typecheck`, `pnpm build`, `git diff --check`

The browser scenario mocks weather providers, exercises keyboard interaction, light/dark rendering, task-card interaction, hourly failure, persisted shutdown and mobile layout. For a physical iPhone, enable the beta, verify scroll/touch, reopen the installed PWA in airplane mode, then disable the beta and verify the normal timeline returns. Browser emulation is not physical-device acceptance.
