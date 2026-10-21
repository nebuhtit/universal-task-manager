import type { WorkspaceLanguage } from '@utm/core';
import './support-development.css';

export const DEVELOPMENT_SUPPORT_URL = 'https://yoomoney.ru/fundraise/1L286389BIR.261021';

const donationCopy = {
  en: { compact: 'Buy me a coffee', heading: 'Donate', button: 'Donate via YooMoney', body: 'If Universal is useful to you, you can support its development voluntarily. Support does not unlock paid features or affect access to the app.', hint: 'An external YooMoney page will open. Check the amount and transfer terms there. Your task data is not sent.' },
  ru: { compact: 'Подарить мне кофе', heading: 'Поддержать разработку', button: 'Поддержать через ЮMoney', body: 'Если Universal вам полезен, вы можете добровольно поддержать его развитие. Поддержка не открывает платные функции и не влияет на доступ к приложению.', hint: 'Откроется внешняя страница ЮMoney. Сумму и условия перевода проверьте там. Данные задач не передаются.' },
  es: { compact: 'Invítame a un café', heading: 'Donar', button: 'Donar a través de YooMoney', body: 'Si Universal te resulta útil, puedes apoyar voluntariamente su desarrollo. El apoyo no desbloquea funciones de pago ni afecta al acceso a la aplicación.', hint: 'Se abrirá una página externa de YooMoney. Comprueba allí el importe y las condiciones. No se envían datos de tus tareas.' },
  de: { compact: 'Spendier mir einen Kaffee', heading: 'Spenden', button: 'Über YooMoney spenden', body: 'Wenn dir Universal hilft, kannst du die Weiterentwicklung freiwillig unterstützen. Dadurch werden keine kostenpflichtigen Funktionen freigeschaltet und der Zugriff auf die App ändert sich nicht.', hint: 'Eine externe YooMoney-Seite wird geöffnet. Prüfe dort Betrag und Bedingungen. Es werden keine Aufgabendaten übertragen.' },
  fr: { compact: 'Offrez-moi un café', heading: 'Faire un don', button: 'Faire un don via YooMoney', body: 'Si Universal vous est utile, vous pouvez soutenir son développement librement. Votre soutien ne débloque aucune fonctionnalité payante et ne modifie pas votre accès à l’application.', hint: 'Une page YooMoney externe va s’ouvrir. Vérifiez le montant et les conditions du transfert. Aucune donnée de tâche n’est envoyée.' },
  ko: { compact: '커피 한 잔 사주세요', heading: '후원하기', button: 'YooMoney로 후원', body: 'Universal이 유용하다면 개발을 자발적으로 후원할 수 있습니다. 후원으로 유료 기능이 열리거나 앱 이용 권한이 달라지지는 않습니다.', hint: '외부 YooMoney 페이지가 열립니다. 금액과 송금 조건을 확인하세요. 작업 데이터는 전송되지 않습니다.' },
} satisfies Record<WorkspaceLanguage, { compact: string; heading: string; button: string; body: string; hint: string }>;

export function DonateButton({ language = 'en', compact = false }: { language?: WorkspaceLanguage; compact?: boolean }) {
  const copy = donationCopy[language];
  const label = compact ? copy.compact : copy.button;
  return <a className="ui-button donate-button" data-variant="secondary" data-size={compact ? 'compact' : 'touch'}
    translate="no" href={DEVELOPMENT_SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
    {label} <span aria-hidden="true">{compact ? '☺️' : '☺️ ↗'}</span>
  </a>;
}

/** A public outbound link only: no payment SDK, workspace data or payment tracking. */
export function SupportDevelopment({ language }: { language: WorkspaceLanguage }) {
  const copy = donationCopy[language];
  return <section translate="no" lang={language} className="support-development">
    <h3>{copy.heading}</h3>
    <p>{copy.body}</p>
    <DonateButton language={language} />
    <p className="hint">{copy.hint}</p>
  </section>;
}
