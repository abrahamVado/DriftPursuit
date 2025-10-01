import { SandboxCanvas } from "../components/SandboxCanvas";
import styles from "./page.module.css";

export default function Page() {
  return (
    <main className={styles.main}>
      <SandboxCanvas />
      <footer className={styles.footer}>
        <span>
          Deterministic endless cave sandbox. Built with Next.js, React, and three.js.
        </span>
        <span>
          Hold Shift to tighten camera lag · Press Space to level wings
        </span>
      </footer>
    </main>
  );
}
