# Historical constellation artwork

The initial collection contains two engravings by Johannes Hevelius from
*Firmamentum Sobiescianum, sive Uranographia* (1690). These are historical
plates, not newly drawn interpretations. Both source pages identify the
reproductions as public domain.

| Figure | Source page | Original image |
| --- | --- | --- |
| Orion | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Orion_constellation_Hevelius.jpg) | [976 × 809 JPEG](https://upload.wikimedia.org/wikipedia/commons/4/45/Orion_constellation_Hevelius.jpg) |
| Leo | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Leo_Hevelius.jpg) | [994 × 800 JPEG](https://upload.wikimedia.org/wikipedia/commons/f/fb/Leo_Hevelius.jpg) |

Orion was uploaded by Wikibob in 2005, citing the PP3 project. Leo's source
page credits the scan to Torsten Bronger and the Linda Hall Library atlas.
The original files are stored unchanged in `img/constellations/`.

`js/constellationart.js` defines independently measured pixel positions of
three identifiable stars per plate, associated with Hipparcos identifiers
in the existing star catalog. An affine registration in a gnomonic plane is
lifted onto the celestial sphere and tessellated for both view projections.
The fit handles the plate's orientation, including the exterior globe
viewpoint. It is an approximate registration of a historical engraving;
other engraved stars need not coincide exactly with modern positions.

At load time, the renderer clips each plate to a hand-traced figure outline,
maps dark ink to pale blue-grey and makes the paper transparent. It does not
reconstruct, redraw or generate parts of the engraving. Original chart marks
and star symbols inside the figure are retained. The celestial artwork follows
precession/nutation and Sky's atmospheric refraction; individual stars' proper
motions and aberration are not applied to the artwork.

Only these two figures are supplied. In particular, this collection does not
claim to cover all 88 modern constellations, or add historical constellations
to the search catalog. The layer and opacity can be set independently in
Chart and Sky. Assets are included in the app's offline cache.

The Mark Crossley Stellarium Hevelius adaptation was investigated but is
**not redistributed**. Its processed images are not used in this collection.

To refresh the source JPEGs, download the two original image URLs in the
table to the corresponding `img/constellations/hevelius-*.jpg` paths. Verify
that their dimensions and star locations still match before replacing them.
