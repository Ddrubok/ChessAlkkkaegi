import { showStartupError } from "./startup-error";

void import("./main").catch(showStartupError);
