export const metadata = {
  title: "Infinite World • Three.js + Next.js",
  description: "Procedural infinite world with vehicles, enemies, and bosses",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0d12", color: "#e6f1ff" }}>
        {children}
      </body>
    </html>
  );
}
