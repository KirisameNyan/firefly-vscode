import * as vscode from "vscode";
import { registerPostProviders } from "./providers/post";
import { registerAnnouncementProviders } from "./providers/announcement";
import { registerCommands } from "./commands";

export function activate(context: vscode.ExtensionContext): void {
  registerPostProviders(context);
  registerAnnouncementProviders(context);
  registerCommands(context);
}

export function deactivate(): void {}
