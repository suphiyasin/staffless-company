---
id: education-academy
name: Education Academy
description: Bright learning platform: confident blue, sunny yellow highlights, progress bars and course cards.
tags: [friendly, blue, light]
best_for: [online courses, schools, tutoring, e-learning platforms]
fonts: [Lexend:400,600,700]
---
# Education Academy

Bright learning platform: confident blue, sunny yellow highlights, progress bars and course cards. Mood: Encouraging, clear, motivating.

## Principles
- Readability first (Lexend, short lines, clear structure).
- Progress is visible: lessons done, time left, certificates.
- Courses are easy to compare: level, duration, rating, price.

## Layout
Hero with headline, search for courses and a learner photo. Category chips, course card grid, 'how it works' steps, instructor highlights, testimonials, pricing or enrol band.

## Typography
Lexend. Headlines 36–56px weight 700. Body 17px/1.7.

## Color
Near-white base, blue primary, yellow accent for highlights, badges and progress fills (never for text).

## Components
- **Buttons:** 10px radius, blue fill; secondary blue outline.
- **Cards:** Course card: thumbnail, level chip, title, instructor, duration, rating, price.
- **Navigation:** Courses / Paths / For teams, Sign in, Start learning button.
- **Forms:** Friendly rounded inputs with helper text.

## Imagery & icons
Real learners and instructors, simple illustrations, filled icons.

## Motion
Progress bars animate once; 200ms hovers.

## Do
- Progress bars
- Level chips
- Certificates

## Don't
- Yellow text on white
- Dense walls of text
- Childish visuals for adult courses

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Lexend:400,600,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
