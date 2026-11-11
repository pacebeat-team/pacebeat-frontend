export interface PermissionItemProps {
  icon: string
  title: string
  tag: string
  descriptions: readonly string[]
}

// Figma `permission / 위치`, `permission / 동작 및 피트니스`: 아이콘 + 제목/태그/설명.
export function PermissionItem({ icon, title, tag, descriptions }: PermissionItemProps) {
  return (
    <div className="flex w-full items-start gap-4">
      <div className="flex size-[32px] shrink-0 items-center justify-center">
        <img src={icon} alt="" className="size-[26px]" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
        <p className="text-[18px] font-medium leading-[26px] text-ink">{title}</p>
        <p className="text-[13px] font-medium leading-[18px] text-muted">{tag}</p>
        <div className="mt-[2px] text-[15px] leading-[22px] text-muted">
          {descriptions.map((description) => (
            <p key={description}>{description}</p>
          ))}
        </div>
      </div>
    </div>
  )
}

export default PermissionItem
