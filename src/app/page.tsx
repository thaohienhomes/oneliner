import { Editor } from "../components/Editor";
import { Gallery } from "../components/Gallery";

// The gallery lists published trailers at request time.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <Editor />
      <Gallery />
    </>
  );
}
