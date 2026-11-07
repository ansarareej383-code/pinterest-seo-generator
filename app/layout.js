import "./globals.css";

export const metadata = {
  title: "Pinterest SEO Content Generator",
  description:
    "Paste any blog article URL and get a Pinterest Board Name, Board Description, Pin Title, Pin Description and categorized Pinterest keywords.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
