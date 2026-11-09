---
id: travel-adventure
name: Travel Adventure
description: Trail-ready energy: forest green, sunset orange, chunky headlines and route maps.
tags: [travel, bold, warm]
best_for: [tour operators, travel blogs, outdoor gear, adventure trips]
fonts: [Archivo:400,600,800]
---
# Travel Adventure

Trail-ready energy: forest green, sunset orange, chunky headlines and route maps. Mood: Adventurous, bold, outdoorsy.

## Principles
- Destinations first: huge landscape photography with bold overlaid headlines.
- Trip facts are scannable: days, difficulty, group size, price.
- Topographic lines and route maps add texture.

## Layout
Full-bleed landscape hero with a big headline and Find your trip. Trip cards in a grid with difficulty bars, a map-based 'where we go' section, itinerary timeline, reviews, newsletter.

## Typography
Archivo 800 headlines 44–96px with tight tracking. Body 17px/1.6. Facts in Archivo 600 uppercase labels.

## Color
Paper base, forest green primary, sunset orange accent for difficulty and 'last spots' badges.

## Components
- **Buttons:** 6px radius, green fill; orange reserved for urgent badges.
- **Cards:** Trip card: landscape photo, days and difficulty chips, price, 'View trip'.
- **Navigation:** Transparent over the hero, then paper; Destinations / Trips / Journal.
- **Forms:** Trip finder: destination, month, style selects.

## Imagery & icons
Wide landscapes and real travellers; topographic line patterns; outdoor pictograms.

## Motion
Parallax-free; 200ms card lifts.

## Do
- Itinerary timelines
- Difficulty indicators
- Topo line textures

## Don't
- Pastel palettes
- Tiny photos
- Generic beach stock

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Archivo:400,600,800.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
