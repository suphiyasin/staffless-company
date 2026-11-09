---
id: tech-mono
name: Tech Mono
description: Terminal aesthetic: near-black, phosphor green, monospaced everything.
tags: [dark, developer, monospace]
best_for: [developer tools, APIs, CLI products, hackathons]
fonts: [JetBrains Mono:400,600,800]
---
# Tech Mono

Terminal aesthetic: near-black, phosphor green, monospaced everything. Mood: Technical, nerdy, direct.

## Principles
- Show code: real snippets, real commands.
- Monospace grid; align things like a terminal.
- Green for success and primary actions, amber for warnings.

## Layout
Hero with a terminal window running an install command, feature list styled as command output, docs links.

## Typography
Monospace everywhere. Headlines 36–56px. Body 15px/1.7. Prompts like '$' and '>' as decoration.

## Color
Near-black background, green primary, amber accent, dim green text for secondary.

## Components
- **Buttons:** Square, green fill with dark text, or bracketed text links like [ get started ].
- **Cards:** Bordered panels with a title bar.
- **Navigation:** Minimal top bar, version tag.
- **Forms:** Prompt-style inputs.

## Imagery & icons
Code blocks, ASCII diagrams, no photos.

## Motion
Typing animation on the hero command, blinking cursor.

## Do
- Copy-able code blocks
- Keyboard-first feel
- Honest specs

## Don't
- Stock photos
- Rounded pills
- Serif fonts

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: JetBrains Mono:400,600,800.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
