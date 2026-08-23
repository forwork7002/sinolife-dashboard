import { ProductsPage } from '@/features/products/ProductsPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <ProductsPage />
}
