import {startWorkbench} from './workbench/app'
import {NativeShell} from './platform/native/shell'

startWorkbench(new NativeShell())
