---
id: glassmorphism
name: Glassmorphism
description: Frosted glass on a vivid gradient: translucent panels, soft white borders and blurred colour behind.
tags: [glass, gradient, tech]
best_for: [apps, dashboards, music players, product launches]
fonts: [Urbanist:400,600,800]
---
# Glassmorphism

Frosted glass on a vivid gradient: translucent panels, soft white borders and blurred colour behind. Mood: Sleek, airy, futuristic.

## Principles
- A vivid gradient mesh (indigo, violet, pink) sits behind everything; panels are frosted glass (backdrop-filter: blur(18px)).
- Glass panels have a 1px translucent white border and a soft shadow.
- Text stays white and readable: never put glass on glass more than twice.

## Layout
Hero with a glass card holding the headline and buttons over the gradient. Feature cards as glass tiles in a grid, a glass screenshot frame, pricing as glass cards, FAQ.

## Typography
Urbanist. Headlines 44–72px weight 800. Body 17px/1.6 in white or light lavender.

## Color
Indigo base with a violet/pink gradient mesh, translucent white surfaces, white primary button with indigo text, pink accent for highlights.

## Components
- **Buttons:** 14px radius, white fill with indigo text; secondary glass button with white border.
- **Cards:** Glass: rgba white 10%, blur 18px, 1px white 22% border, 24px radius.
- **Navigation:** Glass bar, sticky, blurred.
- **Forms:** Glass inputs with white placeholder text and a brighter border on focus.

## Imagery & icons
Abstract gradient blobs, 3D shapes, white line icons.

## Motion
Gradient blobs drift slowly; 200ms hovers.

## Do
- Gradient mesh background
- Frosted panels
- White line icons

## Don't
- Glass on white backgrounds
- Low-contrast text
- Too many layers of blur

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Urbanist:400,600,800.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
