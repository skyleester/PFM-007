import "./globals.css";
import type { Metadata } from "next";
import TopNav from "@/components/TopNav";

export const metadata: Metadata = {
  title: 'PFM',
  description: 'Personal Finance Manager',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50">
        <div className="min-h-screen">
          <TopNav />
          <main className="mx-auto w-full max-w-[1920px] px-4 py-6 sm:px-6 lg:px-8 xl:px-12">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
