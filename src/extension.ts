import * as vscode from "vscode";
import { registerPostProviders } from "./providers/post";
import { registerDynamicProviders } from "./providers/dynamic";
import { registerAnnouncementProviders } from "./providers/announcement";
import { registerCommands } from "./commands";

export function activate(context: vscode.ExtensionContext): void {
  registerPostProviders(context);
  registerDynamicProviders(context);
  registerAnnouncementProviders(context);
  registerCommands(context);
}

export function deactivate(): void {}
