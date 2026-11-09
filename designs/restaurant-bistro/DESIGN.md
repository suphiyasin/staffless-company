---
id: restaurant-bistro
name: Restaurant Bistro
description: A neighbourhood bistro: chalkboard green, butter-cream paper, menu-card typography.
tags: [warm, food, serif]
best_for: [restaurants, bistros, wine bars, brasseries]
fonts: [Fraunces:600,800, Work Sans:400,500,600]
---
# Restaurant Bistro

A neighbourhood bistro: chalkboard green, butter-cream paper, menu-card typography. Mood: Convivial, honest, appetising.

## Principles
- The menu is the hero: dishes, prices and hours are never more than one click away.
- Paper and ink: cream backgrounds, dark green type, no glossy effects.
- Reservations are the main action on every page.

## Layout
Full-width food photo hero with the bistro name and a Book a table button. Then today's specials as a two-column menu list (dish left, price right, dotted leader), a short story block, opening hours and a map band.

## Typography
Fraunces headlines 40–72px weight 800; menu section titles in small caps. Work Sans body 17px/1.65. Prices in tabular figures.

## Color
Cream base, deep bistro green for text and the primary button, terracotta accent for 'new' and 'chef's pick' labels only.

## Components
- **Buttons:** 4px radius, green fill, cream text; secondary is an underlined text link.
- **Cards:** Dish cards: photo, name, one-line description, price; thin border, no shadow.
- **Navigation:** Centred logo, Menu / Story / Visit / Book links, Book as a button.
- **Forms:** Reservation form in one row: date, time, guests, button.

## Imagery & icons
Warm, close-up food photography with natural light; hand-drawn line icons for dietary marks (V, GF).

## Motion
Minimal: 200ms fades; no parallax.

## Do
- Dotted price leaders
- Opening hours in the footer of every page
- Dietary labels

## Don't
- Neon or saturated blues
- Stock photos of empty restaurants
- PDF-only menus

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Fraunces:600,800, Work Sans:400,500,600.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
