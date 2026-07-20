Product Title (hlp) => #product-title ::innerText
Product Price (hlp) => .pdp-price ::innerText
Product Promotions (hlp) =>.pdp-promotion-slider .swiper-slide  ::foreach(innerText)
Product Reviews - Rating (hlp) => #reviews-link .rating ::dataset.rating
Product Reviews - Qty (hlp) => #reviews-link .qty  > span ::innerText

Product Showcased Features =>
.pdp-features (multiple)
    .item (each hlp)
        .t // Feature label
        .v // Feature value


2. Technologies
.pdp-technologies .ftc-item (each hlp) :: foreach(innerText) // Texts can be Summarize'd for low context window

3. Detailed Informations

.pdp-tab #pdp-promotions (hlp)
.pdp-tab #pdp-promotions :: dataset.atcSection // Title
.pdp-tab #pdp-promotions :: toggled(.active)
   .pdp-tab #pdp-promotions .acc-item .act > span ::innerText


.pdp-tab #pdp-technical (hlp)
.pdp-tab #pdp-technical :: dataset.atcSection // Title
.pdp-tab #pdp-technical :: toggled(.active)

.pdp-tab #pdp-technical .feature-item
    .title
    .item (each hlp)
        .t // Prop Label
        .v // Prop Value

.pdp-tab #pdp-downloads (hlp)
.pdp-tab #pdp-downloads :: dataset.atcSection // Title
.pdp-tab #pdp-downloads :: toggled(.active)
    .pdp-tab #pdp-downloads .download-item

.pdp-tab #pdp-downloads .tab-content .item > a (each hlp)
    href
    .v // Label


.pdp-tab #pdp-store-locator (hlp)
.pdp-tab #pdp-store-locator :: dataset.atcSection // Title
.pdp-tab #pdp-store-locator :: toggled(.active)


.pdp-tab #pdp-installments (hlp)
.pdp-tab #pdp-installments :: dataset.atcSection // Title
.pdp-tab #pdp-installments :: toggled(.active)

.pdp-tab #pdp-installments .installments-card .acc-item h4 // Payment Method Names (enough)

.pdp-tab #pdp-refund (hlp)
.pdp-tab #pdp-refund :: dataset.atcSection // Title
.pdp-tab #pdp-refund :: toggled(.active)

.pdp-tab #pdp-refund (highlighted)  ::innerText (Highlight is enough)


.pdp-tab #pdp-allreviews (hlp)
.pdp-tab #pdp-allreviews :: dataset.atcSection // Title
.pdp-tab #pdp-allreviews :: toggled(.active)