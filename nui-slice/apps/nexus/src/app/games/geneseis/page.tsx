import { redirect } from 'next/navigation';

/**
 * NEO2 P0: /games/geneseis — опечатка в адресе. Честный редирект на
 * канонический /games/genesis (страница отдаётся с HTTP 200).
 */
export default function GeneseisRedirectPage() {
  redirect('/games/genesis');
}
