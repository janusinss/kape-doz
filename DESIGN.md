# CAFE DOS native staff design

Android tablet-first staff interface, adapted for phones. The user-supplied [Zillo restaurant POS reference](https://www.behance.net/gallery/248955609/Zillo-Restaurant-POS-System) guides the layout: a light blush workspace, compact white navigation rail, search, outlined category controls, photo-led menu cards, and a white side-by-side order area. The case study presents design mockups; its screenshots do not establish how a live Zillo system behaves. Coffee products, terminology, and staff workflows are specific to this development app.

## Visual tokens

Native Material token source: `mobile/lib/app/cafe_theme.dart`.

| Role | Value |
| --- | --- |
| Canvas / surface | `#FCF2EF` / `#FFFFFF` |
| Ink / muted | `#201B19` / `#655A56` |
| Border / control border | `#E9DFDC` / `#89766F` |
| Field / warm order card | `#F7F5F4` / `#F3DFCA` |
| Accent / warm accent / error | `#D43D19` / `#9C3014` / `#982E22` |

Panels use radius 14 and standard controls radius 8; buttons have a minimum 48 logical-pixel target. Use native sans-serif text, tabular figures for amounts, and visible focus/error states. Orange identifies selected navigation and catalog actions; near-black carries primary filled actions.

## Staff layout

- At viewport widths of 900 logical pixels or more, the header sits above an 84-pixel navigation rail. Below 900, the three navigation labels appear in a horizontal row.
- Register and waste layouts split when their available content width reaches 900 logical pixels. With the 84-pixel rail, this is approximately a 984-pixel viewport. Below it, the register uses menu/ticket tabs and waste history stacks after the entry form.
- The wide register places a searchable, category-filtered drink grid beside a ticket pane 34% of content width, bounded to 350–430 pixels. White photo cards and outlined category controls follow the supplied reference, with coffee content and peso prices. The ticket footer keeps the total and create action visible when items are present. Compact layouts expose a View ticket action when the draft has drinks.
- The barista grid has 3 columns when its padded content width is at least 1100, 2 from 650, and 1 below 650. It shows six cards at once when the 3-column area has sufficient height, with order number, age, drink details, payment state, and ready action.
- Waste entry retains ingredient, quantity, reason, note, presets, and recent history. The wide view uses a 3:2 entry/history split.

The drink photographs are **stock sample images**, not KAPE DOZ product photographs. Their sources and usage details are recorded in `mobile/assets/menu/SOURCES.md`.

## Scope and truth

The staff application contains register, barista, and waste views. Preserve draft customization, dine-in sending, verified payment recording, barista completion, and waste logging through their existing development flows. Owners and managers use the separate admin portal. Development data and sample menu are disclosed in the interface. Printers, cloud synchronization, production identity and permissions, local branch authority, and Android device acceptance remain unfinished; the browser preview is supplementary UI evidence.

## Admin portal

The selected Sales & margin layout is **Margin desk**. Wide screens put the daily sales trend above the sales breakdown, with cost and profit above expense coverage in the right column. The report stacks at 800 CSS pixels and below. Workspace links stay in a left sidebar above 700 CSS pixels. At 700 CSS pixels and below, the header opens a left drawer.

The admin palette is defined in `admin/src/styles.css`. Alabaster (`#F4F1EA`) is the page canvas, concrete (`#D8D2C7`) is the sidebar and reporting filter surface, and espresso (`#2A1E17`) is the text and header color. Wood (`#C88A36`) colors the daily bars. Amber (`#F5B841`) marks the active workspace and peak sales days.

## Staff and admin access

Both access screens follow the 21st.dev `@jahed/components/sign-in` split architecture styled with the KAPE DOZ coffee aesthetic: an authentic artisan coffee hero pane with warm scrim overlay and a frosted-glass testimonial card on one side, paired with a paper form surface, alabaster canvas, and high-contrast espresso action button on the other. Desktop displays the form and hero side-by-side with concentric radii (outer container 24px, inner hero 18px, inputs/buttons 12px); phones use a compact horizontal branded hero header above the form. Staff access switches at 720 logical pixels and admin at 768 CSS pixels. Forms maintain full keyboard and scroll accessibility under 2x text enlargement. Typography follows the existing platform sans-serif with tabular numerals.

Staff production access uses the manager-issued pairing code with auto-sign-in into the assigned cashier or barista station. The optional account/PIN mode and recovery controls remain supported. Admin access uses owner or manager credentials with password visibility toggling and active hub status indicator. The redesign upgrades presentation and touch ergonomics while preserving all existing cryptographic and recovery handlers.
