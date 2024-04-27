import process from 'process';

type MainFunction = (...args: string[]) => Promise<number | void | undefined>;
export default function app(main: MainFunction) {
  const isDebugEnabled = !!JSON.parse(process.env.debug || 'false');
  
  return main(...process.argv.slice(2))
    .then(
      (code) => process.exit(code || 0)
    )
    .catch(
      (err) => {
        console.error(isDebugEnabled ? err : err.message);
        process.exit(1);
      }
    );
}