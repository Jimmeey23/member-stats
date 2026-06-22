import logoSrc from "@/assets/physique57-logo.png";

export function AnimatedLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      className={`group relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={logoSrc}
        alt="Physique 57"
        width={size}
        height={size}
        className="relative z-10 rounded-full object-contain animate-logo-spin-pause transition-transform duration-500 ease-out group-hover:scale-110 group-hover:-rotate-6"
      />
    </div>
  );
}
