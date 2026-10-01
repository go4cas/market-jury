import { AppLayout } from './AppLayout.js'
import { BasicLayout } from './BasicLayout.js'

/** @type {Record<string, (content: unknown) => import('@arrow-js/core').ArrowTemplate>} */
export const layouts = {
  app: AppLayout,
  basic: BasicLayout,
}
