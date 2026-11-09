---
id: bakery-sweet
name: Sweet Bakery
description: A cheerful bakery: strawberry pink, vanilla cream and chocolate text, with soft rounded shapes like icing.
tags: [food, friendly, rounded]
best_for: [bakeries, patisseries, ice cream shops, cake studios]
fonts: [Fredoka:500,600,700, Quicksand:400,500,600]
---
# Sweet Bakery

A cheerful bakery: strawberry pink, vanilla cream and chocolate text, with soft rounded shapes like icing. Mood: Sweet, cheerful, homemade.

## Principles
- Products look good enough to eat: big, bright photos on clean cream.
- Shapes are soft and round, like icing and dough.
- Ordering a cake or finding today's bakes takes one tap.

## Layout
Hero with a wavy bottom edge, today's bakes as a 3–4 column grid, a custom-cake order band, reviews, and a visit section with hours.

## Typography
Fredoka headlines 36–60px weight 600. Quicksand body 17px/1.65. Prices in Fredoka.

## Color
Vanilla cream base, strawberry primary, honey accent for badges ('fresh today'), chocolate brown text.

## Components
- **Buttons:** Fully rounded pills, strawberry fill, soft shadow.
- **Cards:** White, 26px radius, product photo, name, price and a small 'add' button.
- **Navigation:** Rounded white bar, logo centred, order button right.
- **Forms:** Rounded inputs, cream fill, strawberry focus ring.

## Imagery & icons
Bright, top-down product photos; doodle icons (whisk, wheat, cupcake).

## Motion
Gentle bounce on add-to-cart, 250ms easing.

## Do
- Wavy section dividers
- 'Fresh today' badges
- Big product photos

## Don't
- Black backgrounds
- Sharp corners
- Tiny product images

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Fredoka:500,600,700, Quicksand:400,500,600.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
