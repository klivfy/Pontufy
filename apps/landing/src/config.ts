// Configuração central da landing page.
// A URL do sistema Pontufy (aplicação real, com login) é definida via
// variável de ambiente VITE_APP_URL no build. Enquanto o sistema não
// existe, o padrão aponta para o subdomínio planejado.
export const APP_URL: string = import.meta.env.VITE_APP_URL ?? 'https://pontufy.com';

export const LOGIN_URL = `${APP_URL}/login`;
