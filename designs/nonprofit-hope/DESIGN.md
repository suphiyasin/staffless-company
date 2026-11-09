---
id: nonprofit-hope
name: Nonprofit Hope
description: Human and hopeful: leafy green, warm yellow, real faces and a donate button that's always visible.
tags: [warm, friendly, green]
best_for: [charities, NGOs, foundations, community projects]
fonts: [Merriweather:700,900, Libre Franklin:400,600]
---
# Nonprofit Hope

Human and hopeful: leafy green, warm yellow, real faces and a donate button that's always visible. Mood: Hopeful, human, urgent.

## Principles
- People first: real photos and names, not abstract statistics alone.
- Impact is concrete: '€25 = one week of meals'.
- Donate is sticky and appears after every story.

## Layout
Hero with a powerful photo, headline and Donate now. Impact numbers strip, our work in three cards, a story section, donation amount picker, partners, newsletter.

## Typography
Merriweather 900 headlines 36–64px. Libre Franklin body 17px/1.7.

## Color
Warm white base, leaf green primary for Donate, sunshine yellow accent for highlights and progress toward goals.

## Components
- **Buttons:** 8px radius, green fill, heart icon optional.
- **Cards:** Story card: photo, place, name, one-line quote.
- **Navigation:** Logo, About / Our work / Get involved, Donate button.
- **Forms:** Donation picker: preset amounts as chips, monthly toggle, custom amount.

## Imagery & icons
Documentary photos of real people with consent; simple filled icons.

## Motion
Goal progress bar fills once; minimal otherwise.

## Do
- Concrete impact numbers
- Real stories
- Monthly giving option

## Don't
- Pity-driven imagery
- Hidden donate button
- Corporate jargon

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Merriweather:700,900, Libre Franklin:400,600.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
