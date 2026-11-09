---
id: developer-docs
name: Developer Docs
description: Calm documentation: three-column docs layout, readable text, great code blocks and a search that's always there.
tags: [developer, light, minimal]
best_for: [documentation, API references, open-source projects, SDKs]
fonts: [IBM Plex Sans:400,500,600, IBM Plex Mono:400,500]
---
# Developer Docs

Calm documentation: three-column docs layout, readable text, great code blocks and a search that's always there. Mood: Clear, efficient, dependable.

## Principles
- Find, read, copy: search, clear headings and copyable code blocks.
- Three columns: navigation, content (max 760px), on-this-page outline.
- Every page answers one task with a working example first.

## Layout
Top bar with logo, version switcher and search (Ctrl+K). Left sidebar tree, centred content, right 'On this page' outline. Landing page with quick-start cards and install snippet.

## Typography
Plex Sans body 16px/1.7; headings 28–40px weight 600 with anchor links. Code in IBM Plex Mono 14px.

## Color
White base, light grey code backgrounds, blue primary for links and buttons, purple accent for 'new' and API method tags.

## Components
- **Buttons:** 6px radius, blue fill; small copy buttons on code blocks.
- **Cards:** Quick-start cards with icon, title, one line and an arrow.
- **Navigation:** Sidebar with collapsible sections, active page highlighted with a left bar.
- **Forms:** Search modal with keyboard hints.

## Imagery & icons
Diagrams and code; no stock photos. Simple line icons.

## Motion
Almost none; instant navigation.

## Do
- Copy buttons on code
- Version switcher
- Callouts for notes and warnings

## Don't
- Marketing fluff
- Low-contrast code themes
- Text wider than 80 characters

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: IBM Plex Sans:400,500,600, IBM Plex Mono:400,500.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
