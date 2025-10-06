import Head from "next/head";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";

export default function Home() {
  return (
    <>
      <Head>
        <title>DriftPursuit Diagnostics</title>
        <meta
          name="description"
          content="Production build for verifying connectivity with the DriftPursuit broker."
        />
      </Head>
      <main>
        <DiagnosticsPanel />
      </main>
    </>
  );
}
