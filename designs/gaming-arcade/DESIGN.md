---
id: gaming-arcade
name: Gaming Arcade
description: Arcade night: deep purple, neon green and hot pink, pixel headlines and chunky game cards.
tags: [dark, neon, playful]
best_for: [game studios, esports teams, gaming communities, game launches]
fonts: [Press Start 2P:400, Rubik:400,500,700]
---
# Gaming Arcade

Arcade night: deep purple, neon green and hot pink, pixel headlines and chunky game cards. Mood: Fun, competitive, nostalgic.

## Principles
- Play first: trailers, gameplay GIFs and a big Play / Wishlist button.
- Pixel headlines, readable body (never pixel font for paragraphs).
- Community is visible: Discord, leaderboards, events.

## Layout
Hero with a trailer and a pixel headline, platform buttons. Feature cards, leaderboard table, characters carousel, news, community band with Discord.

## Typography
Press Start 2P headlines 24–48px (short words only). Rubik body 17px/1.6.

## Color
Deep purple base, neon green primary, hot pink accent for badges and hover states.

## Components
- **Buttons:** 4px radius, neon green fill with dark text, chunky black outline and drop shadow.
- **Cards:** Purple surface, pixel border, image, title, platform icons.
- **Navigation:** Dark bar, logo, Play now button in green.
- **Forms:** Dark inputs with green focus.

## Imagery & icons
Game screenshots, pixel art, sprite icons.

## Motion
Snappy 100ms; pixel blink on hover (disabled for reduced motion).

## Do
- Trailer hero
- Leaderboards
- Platform badges

## Don't
- Pixel font for long text
- Light backgrounds
- Corporate stock photos

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Press Start 2P:400, Rubik:400,500,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
