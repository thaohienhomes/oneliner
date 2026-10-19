import { Cinzel, Cormorant_Garamond } from "next/font/google";

/** Cinematic serif pair for the title card (canvas) and trailer titles (CSS). */
export const cinzel = Cinzel({ subsets: ["latin"], weight: ["600"], variable: "--font-cinzel" });
export const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400"], style: ["italic"], variable: "--font-cormorant" });
