export default function TransactionsUploadPage() {
  // Importing a client component directly from a server component is supported in App Router
  const UploadClient = require("@/components/transactions/UploadClient").default as React.ComponentType;
  return <UploadClient />;
}
