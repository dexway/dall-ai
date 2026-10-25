// "Trusted by" strip. Add, remove or reorder partners here; the layout adapts on its own.
// logo: a file in /public/partners. Use a white (or single-colour) version on a transparent background,
// ideally SVG. Logos are drawn at a shared height and keep their own aspect ratio.
export type Partner = {
  name: string;
  logo: string;
  width: number;   // intrinsic pixel size of the file, used to keep the aspect ratio
  height: number;
  href?: string;
};

export const PARTNERS_HEADING = "Trusted by";

export const PARTNERS: Partner[] = [
  { name: "Ekomedia", logo: "/partners/ekomedia-white.png", width: 794, height: 216, href: "https://ekomediawebsiteonline.web.app" },
];
