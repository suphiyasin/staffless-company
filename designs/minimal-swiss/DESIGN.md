---
id: minimal-swiss
name: Minimal Swiss
description: International Typographic Style: strict grid, generous white space, black type and a single red accent.
tags: [minimal, light, grid]
best_for: [portfolios, studios, architecture, agencies]
fonts: [Inter:400,500,700,800]
---
# Minimal Swiss

International Typographic Style: strict grid, generous white space, black type and a single red accent. Mood: Calm, precise, confident.

## Principles
- A 12-column grid governs everything; align every edge to it.
- Hierarchy comes from size and weight, never from colour or decoration.
- Red is a signal: one primary action or highlight per screen.

## Layout
Wide left-aligned headlines, asymmetric two-column sections (5/7), large outer margins. Section spacing 96–128px.

## Typography
Headlines 48–96px, weight 800, tight tracking. Body 17px/1.6. Small uppercase labels (12px, 0.08em) above sections.

## Color
Black text on white. Grey surfaces for secondary blocks. Red only for the main call to action and active states.

## Components
- **Buttons:** Rectangular, no radius, solid red primary; secondary is a black text link with an arrow.
- **Cards:** No shadows; separated by 1px rules and white space.
- **Navigation:** Text-only, right-aligned, active item underlined in red.
- **Forms:** Underlined inputs, labels above in small caps.

## Imagery & icons
Large, cropped black-and-white or high-contrast photography; thin line icons only.

## Motion
Almost none: 150ms fades.

## Do
- Use lots of white space
- Left-align text
- Let one big number or word carry a section

## Don't
- Rounded corners
- Gradients
- More than one accent colour

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Inter:400,500,700,800.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
