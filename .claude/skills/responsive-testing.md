# Skill: Responsive & Mobile Testing

## Purpose

Test PopularCert AI across all viewport sizes and devices.

## Viewport Sizes

```text
Mobile:      320px  375px  390px  414px
Tablet:      768px  810px  1024px
Desktop:     1280px 1440px 1920px
```

## Playwright Commands

```bash
# Test specific viewport
cd playwright && npx playwright test responsive.spec.js

# Test mobile only
cd playwright && npx playwright test --project=mobile-chrome

# Test tablet
cd playwright && npx playwright test --project=tablet
```

## What to Check

### 1. Horizontal Overflow

```javascript
const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
const innerWidth = await page.evaluate(() => window.innerWidth);
expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 5);
```

### 2. Touch Targets

All interactive elements must be at least 44x44px on mobile.

### 3. Sidebar Behavior

- Mobile: Hamburger menu → overlay sidebar
- Tablet: May be collapsible
- Desktop: Always visible

### 4. Forms

- Inputs must be usable on mobile
- Keyboard must not overlap inputs
- Dropdowns must fit on screen

### 5. Modals

- Must fit within viewport
- Buttons must be accessible
- Scroll must work correctly

### 6. Tables

- Must scroll horizontally on mobile
- Or stack into cards

### 7. Dropdowns

- Must not clip outside viewport
- Must be scrollable if many options

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Horizontal scroll | Element wider than viewport | Use `max-width: 100%` |
| Clipped dropdown | `overflow: hidden` on parent | Use `overflow: visible` or position differently |
| Cramped forms | Fixed widths | Use responsive widths |
| Tiny buttons | No mobile-specific sizing | Add min-height/min-width |
| Modal overflow | Larger than viewport | Add max-height, scroll |

## Testing Checklist

- [ ] 320px — No horizontal overflow
- [ ] 375px — Sidebar works
- [ ] 375px — Forms are usable
- [ ] 375px — Modals fit on screen
- [ ] 375px — Dropdowns are accessible
- [ ] 768px — Tablet layout appropriate
- [ ] 1024px — Desktop layout correct
- [ ] 1440px — Full-width layout correct
- [ ] All sizes — Touch targets adequate
- [ ] All sizes — Text is readable
