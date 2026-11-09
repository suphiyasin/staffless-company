---
id: fine-dining
name: Fine Dining
description: Candle-lit luxury: charcoal, champagne gold and airy serif headlines with lots of darkness around them.
tags: [dark, elegant, food]
best_for: [fine dining, tasting menus, cocktail bars, private chefs]
fonts: [Cormorant Garamond:500,600,700, Jost:400,500]
---
# Fine Dining

Candle-lit luxury: charcoal, champagne gold and airy serif headlines with lots of darkness around them. Mood: Hushed, refined, theatrical.

## Principles
- Darkness is the canvas: one lit dish or detail per screen.
- Restraint: few words, wide spacing, thin gold rules.
- Every page leads to a reservation or the tasting menu.

## Layout
Full-screen dark hero with a single plated dish photo and the restaurant name centred. Sections separated by 120px of space and a thin gold rule. Tasting menu as a centred list of courses.

## Typography
Cormorant headlines 44–80px, weight 600, slight positive tracking. Jost body 16px/1.8 in warm off-white; small uppercase labels with 0.2em tracking.

## Color
Charcoal background, slightly lighter surfaces, champagne gold for the primary button, rules and active links; muted bronze accent sparingly.

## Components
- **Buttons:** Square, gold outline or gold fill with charcoal text, uppercase 13px label with wide tracking.
- **Cards:** No boxes: images with a caption beneath, separated by space.
- **Navigation:** Transparent over the hero, centred logo, links split left and right.
- **Forms:** Underlined inputs on dark, gold focus line.

## Imagery & icons
Moody, low-key food and interior photography; no icons except a thin gold monogram.

## Motion
Slow 400ms fades and gentle image zoom on hover.

## Do
- Huge empty space
- Course-by-course menu
- Thin gold dividers

## Don't
- Bright backgrounds
- Bold sans-serif headlines
- Discount badges

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Cormorant Garamond:500,600,700, Jost:400,500.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
