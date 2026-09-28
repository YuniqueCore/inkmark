/** 极简 Screenplay 内核：Actor / Ability / Interaction / Task / Question。
 *
 * 不引入第三方框架——固化的是层次约定而非机制：
 * Task 组合 Interaction 与子 Task；Interaction 一步原子操作、不断言；
 * Question 只读、返回领域值；断言只出现在 specs（web-first expect）。
 */

export abstract class Ability {}

/** 可被 Actor 执行的动作（Task 与 Interaction 的公共形态） */
export interface Performable {
  perform(actor: Actor): Promise<void>
}

export class Interaction implements Performable {
  private constructor(
    private readonly description: string,
    private readonly performFn: (actor: Actor) => Promise<void>,
  ) {}

  static where(description: string, performFn: (actor: Actor) => Promise<void>): Interaction {
    return new Interaction(description, performFn)
  }

  async perform(actor: Actor): Promise<void> {
    await this.performFn(actor)
  }

  toString(): string {
    return this.description
  }
}

export class Task implements Performable {
  private constructor(
    private readonly description: string,
    private readonly steps: Performable[],
  ) {}

  static where(description: string, ...steps: Performable[]): Task {
    return new Task(description, steps)
  }

  async perform(actor: Actor): Promise<void> {
    for (const step of this.steps) await step.perform(actor)
  }

  toString(): string {
    return this.description
  }
}

export interface QuestionLike<T> {
  readonly subject: string
  answeredBy(actor: Actor): Promise<T>
}

export const Question = {
  about: <T>(subject: string, answeredBy: (actor: Actor) => Promise<T>): QuestionLike<T> => ({
    subject,
    answeredBy,
  }),
}

export class Actor {
  private abilities = new Map<Function, Ability>()

  private constructor(readonly name: string) {}

  static named(name: string): Actor {
    return new Actor(name)
  }

  whoCan(...abilities: Ability[]): this {
    for (const ability of abilities) this.abilities.set(ability.constructor, ability)
    return this
  }

  abilityTo<T extends Ability>(type: new (...args: never[]) => T): T {
    const ability = this.abilities.get(type)
    if (!ability) throw new Error(`${this.name} 缺少能力 ${type.name}`)
    return ability as T
  }

  async attemptsTo(...actions: Performable[]): Promise<void> {
    for (const action of actions) await action.perform(this)
  }

  asks<T>(question: QuestionLike<T>): Promise<T> {
    return question.answeredBy(this)
  }
}
