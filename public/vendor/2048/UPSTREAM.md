Source: https://github.com/gabrielecirulli/2048
Commit: 478b6ec346e3787f589e4af751378d06ded4cbbc
License: MIT (LICENSE.txt)
Game logic reused unchanged. Local changes: Chinese shell/messages, isolated iframe/CSP, local storage key prefix, no external fonts or network services.

2026-10-24: application.js now bridges to the parent website for server-seeded games and move replay verification; upstream grid, tile and game_manager rules remain unchanged. The iframe remains an opaque sandbox with no network permission. Public rankings use the website API in the parent; player names and best scores are public.
