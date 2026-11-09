---
id: medical-clinic
name: Medical Clinic
description: Clear and reassuring care: clinical white, calm teal and a strong focus on appointments and accessibility.
tags: [health, professional, light]
best_for: [clinics, hospitals, therapists, health services]
fonts: [Public Sans:400,600,700]
---
# Medical Clinic

Clear and reassuring care: clinical white, calm teal and a strong focus on appointments and accessibility. Mood: Trustworthy, clean, caring.

## Principles
- Accessibility is non-negotiable: large text, high contrast, visible focus states.
- Book an appointment and call the clinic are visible on every page.
- Plain language: say what happens, how long, what it costs.

## Layout
Hero with headline, search or 'Book appointment' and phone number. Services grid with icons, doctor cards, a 'what to expect' three-step strip, insurance logos, location and hours.

## Typography
Public Sans throughout. Headlines 36–56px weight 700. Body 18px/1.65 (slightly larger for readability).

## Color
White base, pale teal surfaces, deep teal primary; blue accent only for links and info notes; red only for emergency notices.

## Components
- **Buttons:** 8px radius, teal fill; secondary teal outline. Minimum 44px tall.
- **Cards:** Pale teal surface, line icon, service name, two-line description, 'Learn more'.
- **Navigation:** White bar, phone number and Book button on the right.
- **Forms:** Large labelled inputs, clear error messages under fields.

## Imagery & icons
Real, friendly staff and patients in bright rooms; simple medical line icons.

## Motion
Minimal; respect prefers-reduced-motion.

## Do
- Phone number in the header
- Doctor profiles with specialities
- Clear opening hours

## Don't
- Dark themes
- Tiny grey text
- Scary clinical imagery

## Using this design
- Link `design/tokens.css` before your own stylesheet and use its variables (`var(--color-primary)`, `var(--font-heading)`, `var(--radius)`…) instead of hard-coded values.
- Load the fonts from Google Fonts: Public Sans:400,600,700.
- Adapt it to the project (content, sections, imagery); keep the principles and the tokens.
