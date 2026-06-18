import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

interface TooltipProviderProps {
  children: ReactNode;
}

export function TooltipProvider({ children }: TooltipProviderProps) {
  return <Tooltip.Provider>{children}</Tooltip.Provider>;
}
