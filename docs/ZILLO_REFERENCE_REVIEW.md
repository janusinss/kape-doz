# Zillo reference review

Source: [Zillo — Restaurant POS System on Behance](https://www.behance.net/gallery/248955609/Zillo-Restaurant-POS-System), a design case study. Reviewed on 3 November 2026 for the KAPE DOZ staff application.

The Behance project page returned HTTP 403 to direct retrieval. Publicly indexed project images were available separately and inspected in `scratch/zillo-thumb.png`, `scratch/zillo-mobile.png`, and `scratch/zillo-features.png`. These files are reference-only and are not app assets. The retrieved images show desktop register, mobile catalog, customization, order summary, table-management and order-list mockups. They do not show a dedicated kitchen display or waste screen.

## Observed design

- **Desktop register:** narrow white icon rail; light toolbar with search; pale blush content area; outlined category pills; three-column white photo cards with price and orange Add or quantity controls; persistent white order panel with item thumbnails, modifiers, a summary, and bottom billing actions.
- **Mobile catalog:** search and horizontally scrolling category pills over a two-column photo grid, with an orange View Order action at the bottom.
- **Customization:** a bottom sheet over a dimmed catalog shows the product, option controls, quantity adjustment and an Add action.
- **Order summary:** compact image-and-text item rows show modifiers, prices and edit affordances; a total summary and primary action sit below them.
- **Other depicted screens:** a table map and table service sheet, and an order list with status filters, appear in the case-study images.

## Application to KAPE DOZ

| Reference concept | KAPE DOZ application |
| --- | --- |
| Catalog, search and categories | Sample coffee and non-coffee catalog, peso prices and existing menu search/filter behavior. |
| Customization | Existing drink options and captured recipe quantities; keep selections tied to actual development logic. |
| Order summary | Existing draft, table reference, total, order creation and payment flows; preserve their established rules. |
| Kitchen coordination | Retain the separately selected six-card warm barista station; the retrieved Zillo images do not specify its appearance. |
| Waste and dial-in | Retain the KAPE DOZ ingredient entry and history flow; the retrieved Zillo images do not specify this feature. |

The drink photos currently shipped with the development app are illustrative stock, not verified photos of the café's products. Their sources are listed in `mobile/assets/menu/SOURCES.md`.

## Evidence and implementation limits

The screenshots are design evidence, not access to a working Zillo deployment. Animation, navigation transitions, backend contracts, tax calculation, receipt behavior, authentication, and kitchen synchronization cannot be established from them. Restaurant-specific taxes, claims and sample data must not be treated as café requirements.

The pictured table map and status-filtered order list are reference concepts, not implemented KAPE DOZ features. Receipt printing and actual printer connectivity are also not implemented. The staff application remains a local development build; cloud sync, production identity and device integration require separate implementation and verification.
