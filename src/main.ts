import {startWorkbench} from './workbench/app'
import {BrowserShell} from './ui/browser-shell'

export const __debug = startWorkbench(new BrowserShell())
