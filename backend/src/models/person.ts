import { hy } from "hydratable";
import { BaseDoc, BaseModel } from "./baseDoc";

export interface PersonModal extends BaseModel {
  name: string;
  phone: string;
}

export class Person extends BaseDoc<PersonModal> implements PersonModal {
  @hy('string') name: string;
  @hy('string') phone: string;
}
